const planes = {
  axial: { axis: 2, horizontal: 0, vertical: 1, flip: false },
  coronal: { axis: 1, horizontal: 0, vertical: 2, flip: true },
  sagittal: { axis: 0, horizontal: 1, vertical: 2, flip: true },
};

function scaleIndex(index, fromLength, toLength) {
  if (fromLength === 1) return Math.floor(toLength / 2);
  return Math.round(index * (toLength - 1) / (fromLength - 1));
}

export function createSliceViews(voxels, metadata) {
  const { size, spacingMm } = metadata;
  const sliceCounts = size.map(length => Math.min(length, size[2]));
  const selection = sliceCounts.map(count => Math.floor(count / 2));
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
    slider.max = sliceCounts[axis] - 1;
    slider.disabled = false;

    slider.addEventListener("input", () => {
      selection[axis] = Number(slider.value);
      draw();
    });
    canvas.addEventListener("click", event => {
      const rect = canvas.getBoundingClientRect();
      const column = Math.floor((event.clientX - rect.left) * columns / rect.width);
      const row = Math.floor((event.clientY - rect.top) * rows / rect.height);
      const horizontalIndex = Math.max(0, Math.min(columns - 1, column));
      const verticalIndex = flip ? rows - 1 - row : row;
      const clampedVertical = Math.max(0, Math.min(rows - 1, verticalIndex));
      selection[horizontal] = scaleIndex(horizontalIndex, columns, sliceCounts[horizontal]);
      selection[vertical] = scaleIndex(clampedVertical, rows, sliceCounts[vertical]);
      draw();
    });

    return { axis, horizontal, vertical, flip, canvas, slider, readout, buffer, image, source, context };
  });

  function draw() {
    const index = selection.map((choice, axis) => scaleIndex(choice, sliceCounts[axis], size[axis]));
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
      context.strokeStyle = "rgb(255 255 255 / 60%)";
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
      slider.value = selection[axis];
      readout.value = `${selection[axis] + 1} / ${sliceCounts[axis]}`;
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
