const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

let drawing = false;
let lastX = 0;
let lastY = 0;

function updateColorSwatch() {
  colorPicker.style.backgroundColor = colorPicker.value;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const nextWidth = Math.round(width * ratio);
  const nextHeight = Math.round(height * ratio);

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const point = event.touches?.[0] || event;
  return {
    x: point.clientX - rect.left,
    y: point.clientY - rect.top,
  };
}

function beginStroke(event) {
  event.preventDefault();
  const point = getPoint(event);
  drawing = true;
  lastX = point.x;
  lastY = point.y;
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
}

function drawStroke(event) {
  if (!drawing) return;
  event.preventDefault();
  const point = getPoint(event);
  ctx.strokeStyle = colorPicker.value;
  ctx.lineWidth = Number(brushSize.value);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  lastX = point.x;
  lastY = point.y;
}

function endStroke() {
  if (!drawing) return;
  drawing = false;
  ctx.closePath();
}

clearBtn.addEventListener("click", () => {
  drawing = false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
});

saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "whiteboard.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

colorPicker.addEventListener("input", updateColorSwatch);
updateColorSwatch();

canvas.addEventListener("touchstart", beginStroke, { passive: false });
canvas.addEventListener("touchmove", drawStroke, { passive: false });
canvas.addEventListener("touchend", endStroke);
canvas.addEventListener("touchcancel", endStroke);

canvas.addEventListener("mousedown", beginStroke);
canvas.addEventListener("mousemove", drawStroke);
window.addEventListener("mouseup", endStroke);
canvas.addEventListener("mouseleave", endStroke);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);
window.addEventListener("load", resizeCanvas);
