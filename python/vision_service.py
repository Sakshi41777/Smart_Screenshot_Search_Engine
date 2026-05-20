import io
import os
from typing import Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from transformers import BlipForConditionalGeneration, BlipProcessor
import open_clip
import torch


APP_HOST = os.environ.get("LOCAL_VISION_HOST", "127.0.0.1")
APP_PORT = int(os.environ.get("LOCAL_VISION_PORT", "5055"))
MODEL_NAME = os.environ.get("LOCAL_VISION_MODEL", "Salesforce/blip-image-captioning-base")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
CLIP_MODEL = os.environ.get("LOCAL_CLIP_MODEL", "ViT-B-32")
CLIP_PRETRAINED = os.environ.get("LOCAL_CLIP_PRETRAINED", "laion2b_s34b_b79k")

app = FastAPI(title="SmartShot Local Vision")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_processor: Optional[BlipProcessor] = None
_model: Optional[BlipForConditionalGeneration] = None
_clip_model = None
_clip_preprocess = None
_clip_tokenizer = None


def get_model():
    global _processor, _model
    if _processor is None or _model is None:
        _processor = BlipProcessor.from_pretrained(MODEL_NAME)
        _model = BlipForConditionalGeneration.from_pretrained(MODEL_NAME)
        _model.to(DEVICE)
        _model.eval()
    return _processor, _model


def get_clip():
    global _clip_model, _clip_preprocess, _clip_tokenizer
    if _clip_model is None or _clip_preprocess is None or _clip_tokenizer is None:
        _clip_model, _, _clip_preprocess = open_clip.create_model_and_transforms(
            CLIP_MODEL, pretrained=CLIP_PRETRAINED
        )
        _clip_tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
        _clip_model.to(DEVICE)
        _clip_model.eval()
    return _clip_model, _clip_preprocess, _clip_tokenizer


@app.get("/health")
def health():
    return {
        "ok": True,
        "device": DEVICE,
        "model": MODEL_NAME,
        "clip_model": CLIP_MODEL,
        "clip_pretrained": CLIP_PRETRAINED,
    }


@app.post("/caption")
async def caption(image: UploadFile = File(...)):
    data = await image.read()
    if not data:
        return {"ok": False, "error": "empty_image"}

    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return {"ok": False, "error": "invalid_image"}

    processor, model = get_model()
    inputs = processor(images=img, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=40,
            num_beams=3,
        )
    text = processor.decode(out[0], skip_special_tokens=True)
    return {"ok": True, "text": text.strip()}


@app.post("/embed-image")
async def embed_image(image: UploadFile = File(...), model: Optional[str] = None, pretrained: Optional[str] = None):
    data = await image.read()
    if not data:
        return {"ok": False, "error": "empty_image"}

    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return {"ok": False, "error": "invalid_image"}

    # allow per-request override
    global CLIP_MODEL, CLIP_PRETRAINED
    if model and model != CLIP_MODEL:
        CLIP_MODEL = model
        # reset cached model
        globals()["_clip_model"] = None
        globals()["_clip_preprocess"] = None
        globals()["_clip_tokenizer"] = None
    if pretrained and pretrained != CLIP_PRETRAINED:
        CLIP_PRETRAINED = pretrained
        globals()["_clip_model"] = None
        globals()["_clip_preprocess"] = None
        globals()["_clip_tokenizer"] = None

    clip_model, preprocess, _ = get_clip()
    with torch.no_grad():
        image_in = preprocess(img).unsqueeze(0).to(DEVICE)
        vec = clip_model.encode_image(image_in)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return {"ok": True, "vector": vec[0].cpu().tolist(), "model": CLIP_MODEL, "pretrained": CLIP_PRETRAINED}


@app.post("/embed-text")
async def embed_text(payload: dict):
    text = str(payload.get("text", "")).strip()
    if not text:
        return {"ok": False, "error": "empty_text"}

    model = payload.get("model")
    pretrained = payload.get("pretrained")
    global CLIP_MODEL, CLIP_PRETRAINED
    if model and model != CLIP_MODEL:
        CLIP_MODEL = model
        globals()["_clip_model"] = None
        globals()["_clip_preprocess"] = None
        globals()["_clip_tokenizer"] = None
    if pretrained and pretrained != CLIP_PRETRAINED:
        CLIP_PRETRAINED = pretrained
        globals()["_clip_model"] = None
        globals()["_clip_preprocess"] = None
        globals()["_clip_tokenizer"] = None

    clip_model, _, tokenizer = get_clip()
    with torch.no_grad():
        tokens = tokenizer([text]).to(DEVICE)
        vec = clip_model.encode_text(tokens)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return {"ok": True, "vector": vec[0].cpu().tolist(), "model": CLIP_MODEL, "pretrained": CLIP_PRETRAINED}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=APP_HOST, port=APP_PORT)
