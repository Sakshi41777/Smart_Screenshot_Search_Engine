// client/src/search/fileHeuristics.js
export function fileToResultObject(file, relativePath = "") {
  const sizeKB = Math.round((file.size || 0) / 1024);
  const name = file.name.toLowerCase();

  let type = "document";
  if (file.type.startsWith("image/")) type = "image";
  if (/screenshot|screen/.test(name)) type = "screenshot";

  let score = 0.5;
  if (type === "image") score = 0.7;
  if (/invoice|bill|receipt/.test(name)) score = 0.92;

  return {
    name: file.name,
    path: relativePath || file.name,
    file,
    type,
    sizeKB,
    size: `${sizeKB} KB`,
    score,
    extractText: "",
    _source: "local",
  };
}
