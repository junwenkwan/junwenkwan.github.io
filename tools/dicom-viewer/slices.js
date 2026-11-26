const planes = {
  axial: { axis: 2, horizontal: 0, vertical: 1, flip: false },
  coronal: { axis: 1, horizontal: 0, vertical: 2, flip: true },
  sagittal: { axis: 0, horizontal: 1, vertical: 2, flip: true },
};
const axisColours = ["#e5b776", "#66d5ed", "#b5a5fd"];

export function createSliceViews(voxels, metadata) {
  const { size, spacingMm } = metadata;
  const index = size.map(length => Math.floor(length / 2));
  const stride = [1, size[0], size[0] * size[1]];
  let whitePoint = 1;

  const views = Array.from(document.querySelectorAll("[data-plane]"), card => {
    const { axis, horizontal, vertical, flip } = planes[card.dataset.plane];
    const canvas = card.querySelector("canvas");
    const slider = card.querySelector("input");
    const readout = card.querySelector("output");
    const columns = size[horizontal];
    const rows = size[vertical];
    const physicalWidth = columns * spacingMm[horizontal];
    const physicalHeight = rows * spacingMm[vertical];
    const scale = 400 / Math.max(physicalWidth, physicalHeight);
    canvas.width = Math.round(physicalWidth * scale);
    canvas.height = Math.round(physicalHeight * scale);

    const buffer = document.createElement("canvas");
    buffer.width = columns;
    buffer.height = rows;
    const source = buffer.getContext("2d");
    const image = source.createImageData(columns, rows);
    const context = canvas.getContext("2d");
    slider.max = size[axis] - 1;
    slider.disabled = false;

    slider.addEventListener("input", () => {
      index[axis] = Number(slider.value);
      draw();
    });
    canvas.addEventListener("click", event => {
      const rect = canvas.getBoundingClientRect();
      const column = Math.floor((event.clientX - rect.left) * columns / rect.width);
      const row = Math.floor((event.clientY - rect.top) * rows / rect.height);
      index[horizontal] = Math.max(0, Math.min(columns - 1, column));
      const verticalIndex = flip ? rows - 1 - row : row;
      index[vertical] = Math.max(0, Math.min(rows - 1, verticalIndex));
      draw();
    });

    return { axis, horizontal, vertical, flip, canvas, slider, readout, buffer, image, source, context };
  });

  function draw() {
    for (const view of views) {
      const { axis, horizontal, vertical, flip, canvas, slider, readout, buffer, image, source, context } = view;
      const { width: columns, height: rows } = buffer;
      const base = index[axis] * stride[axis];
      let pixel = 0;
      for (let row = 0; row < rows; row++) {
        const offset = base + (flip ? rows - 1 - row : row) * stride[vertical];
        for (let column = 0; column < columns; column++) {
          const value = Math.min(255, Math.round(voxels[offset + column * stride[horizontal]] / whitePoint));
          image.data[pixel++] = value;
          image.data[pixel++] = value;
          image.data[pixel++] = value;
          image.data[pixel++] = 255;
        }
      }

      source.putImageData(image, 0, 0);
      context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
      const x = (index[horizontal] + 0.5) / columns * canvas.width;
      const verticalCentre = (index[vertical] + 0.5) / rows;
      const y = (flip ? 1 - verticalCentre : verticalCentre) * canvas.height;
      context.lineWidth = 1.5;
      context.strokeStyle = axisColours[horizontal];
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
      context.strokeStyle = axisColours[vertical];
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
      slider.value = index[axis];
      readout.value = `${index[axis] + 1} / ${size[axis]}`;
    }
  }

  draw();
  return {
    setWhitePoint(value) {
      if (whitePoint !== value) {
        whitePoint = value;
        draw();
      }
    },
  };
}
