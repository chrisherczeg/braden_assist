const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const clearBtn = document.getElementById("clearBtn");
const saveBtn = document.getElementById("saveBtn");

let drawing = false;
let lastX = 0;
let lastY = 0;

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();

  if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
}

function getPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const clientX = event.touches ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches ? event.touches[0].clientY : event.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
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

function preventPageScroll(event) {
  if (event.target === canvas || drawing) {
    event.preventDefault();
  }
}

document.addEventListener("touchmove", preventPageScroll, { passive: false });

clearBtn.addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resizeCanvas();
});

saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "whiteboard.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
});

canvas.addEventListener("pointerdown", beginStroke);
canvas.addEventListener("pointermove", drawStroke);
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointerleave", endStroke);
canvas.addEventListener("pointercancel", endStroke);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);
