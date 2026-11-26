# /// script
# requires-python = ">=3.10"
# dependencies = ["pydicom>=3,<4", "numpy"]
# ///

import json
from argparse import ArgumentParser
from pathlib import Path

import numpy as np
from pydicom import dcmread

parser = ArgumentParser(description="Export an Enhanced MR volume for the DICOM post.")
parser.add_argument("dicom", nargs="?", type=Path, default=Path("IMG-0001-00001.dcm"))
parser.add_argument("--output", type=Path, default=Path("volume-viewer"))
args = parser.parse_args()

dataset = dcmread(args.dicom)
groups = dataset.PerFrameFunctionalGroupsSequence

positions = np.array([
    frame.PlanePositionSequence[0].ImagePositionPatient for frame in groups
], dtype=float)
orientations = np.array([
    frame.PlaneOrientationSequence[0].ImageOrientationPatient for frame in groups
], dtype=float)
pixel_measures = [frame.PixelMeasuresSequence[0] for frame in groups]
spacing = np.array([measures.PixelSpacing for measures in pixel_measures], dtype=float)
if not (np.allclose(orientations, orientations[0]) and np.allclose(spacing, spacing[0])):
    raise ValueError("This viewer expects parallel slices with matching pixel spacing.")

# Project each slice origin onto the slice normal to get the physical order.
normal = np.cross(orientations[0, :3], orientations[0, 3:])
normal /= np.linalg.norm(normal)
distance = positions @ normal
order = np.argsort(distance)
slice_steps = np.diff(distance[order])
slice_spacing = float(np.median(slice_steps))
in_plane = positions - np.outer(distance, normal)
if (slice_spacing <= 0 or not np.allclose(slice_steps, slice_spacing, atol=0.01)
        or not np.allclose(in_plane, in_plane[0], atol=0.01, rtol=0)):
    raise ValueError("The slice positions need resampling before they form a regular volume.")

frames = dataset.pixel_array[order]
depth, height, width = frames.shape
transforms = [groups[int(index)].PixelValueTransformationSequence[0] for index in order]
slope = np.array([float(t.RescaleSlope) for t in transforms], dtype=np.float32)
intercept = np.array([float(t.RescaleIntercept) for t in transforms], dtype=np.float32)

# Keep the acquired pixel grid and apply each frame's intensity rescale.
volume = frames.astype(np.float32)
volume *= slope[:, None, None]
volume += intercept[:, None, None]

# Use one intensity scale for the whole volume so adjacent slices blend consistently.
ceiling = float(np.percentile(volume, 99.5))
if ceiling <= 0:
    raise ValueError("The volume has no positive intensities to display.")
voxels = np.rint(np.clip(volume / ceiling, 0, 1) * 255).astype(np.uint8)

row_spacing, column_spacing = spacing[0]
metadata = {
    "size": [width, height, depth],
    "spacingMm": [float(column_spacing), float(row_spacing), slice_spacing],
    "sourcePixelSpacingMm": [float(row_spacing), float(column_spacing)],
    "sliceThicknessMm": float(pixel_measures[0].SliceThickness),
}
output = args.output
output.mkdir(parents=True, exist_ok=True)
voxels.tofile(output / "volume.bin")
(output / "volume.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(f"Exported {depth} slices as a {width} × {height} × {depth} display volume.")
print(f"Slice spacing: {slice_spacing:.2f} mm.")
