+++
date = '2026-11-26'
draft = false
title = 'Understanding DICOM'
tags = ['python', 'medical-imaging']
hideAuthor = true
ShowCodeCopyButtons = true
+++

Digital Imaging and Communications in Medicine (DICOM) is the international standard for medical imaging information and related data. It defines the formats for medical images used in clinical practice.

The [T2 TSE tra](https://www.magnetomworld.siemens-healthineers.com/korean-dicom-image-gallery) example from the Siemens Healthineers gallery contains 21 MR frames in a single file. The examples use pydicom and NumPy and expect `IMG-0001-00001.dcm` in the current directory.

```python
import numpy as np
from pydicom import dcmread
from pydicom.pixels import pixel_array

path = "IMG-0001-00001.dcm"
ds = dcmread(path, stop_before_pixels=True)

# Read the image and scanner metadata.
print(ds.SOPClassUID.name)  # Enhanced MR Image Storage
print(ds.NumberOfFrames, ds.Rows, ds.Columns)  # 21 frames, 896 rows, 732 columns
print(ds.Modality)  # MR
print(ds.get("ManufacturerModelName"))  # MAGNETOM Vida
print(ds.get("MagneticFieldStrength"))  # 3 tesla
print(ds.file_meta.TransferSyntaxUID.name)  # Explicit VR Little Endian

# (0028,0010) is the DICOM tag for Rows. US means unsigned 16-bit integer.
rows = ds[0x0028, 0x0010]
print(rows.tag, rows.VR, rows.value)  # (0028,0010) US 896, meaning 896 rows

# Enhanced MR stores pixel spacing and display settings per frame.
frame_info = ds.PerFrameFunctionalGroupsSequence[0]
measures = frame_info.PixelMeasuresSequence[0]
window = frame_info.FrameVOILUTSequence[0]

# Pixel spacing measures the distance between adjacent pixel centres.
print(measures.PixelSpacing)  # 0.2567 mm between rows and between columns

# The window maps a range of intensities to shades of grey.
print(window.WindowCenter, window.WindowWidth)  # centre 517, width 1102

# Decode nine frames spread across the scan.
indices = np.linspace(0, int(ds.NumberOfFrames) - 1, 9, dtype=int)
frames = [pixel_array(path, index=int(index)) for index in indices]
print(len(frames), *frames[0].shape)  # 9 frames, 896 rows, 732 columns
```

{{< asset-figure src="images/understanding-dicom/frame-grid.png" alt="Nine axial MR frames arranged in a labelled 3 by 3 grid" caption="Nine frames sampled across the 21-frame scan. Each uses its stored display window." >}}

## Explore the volume in 3D

The export uses each frame’s position and orientation to build a stack in physical order.

```python
import json
from pathlib import Path

# Reuse ds and path from the example above.
groups = ds.PerFrameFunctionalGroupsSequence
positions = np.array([
    frame.PlanePositionSequence[0].ImagePositionPatient
    for frame in groups
], dtype=float)

# Sort by distance along the slice normal, perpendicular to each image.
orientation = groups[0].PlaneOrientationSequence[0].ImageOrientationPatient
normal = np.cross(orientation[:3], orientation[3:])
normal /= np.linalg.norm(normal)
distances = positions @ normal
order = np.argsort(distances)
frames = pixel_array(path)[order]
slice_spacing = float(np.median(np.diff(distances[order])))

# Keep the acquired pixel grid and pack each display intensity into one byte.
volume = frames.astype(np.float32)
ceiling = float(np.percentile(volume, 99.5))
voxels = np.rint(np.clip(volume / ceiling, 0, 1) * 255).astype(np.uint8)

# Save the voxels and their geometry for Three.js.
depth, height, width = voxels.shape
pixel_measures = groups[0].PixelMeasuresSequence
row_spacing, column_spacing = pixel_measures[0].PixelSpacing
metadata = {
    "size": [width, height, depth],
    "spacingMm": [float(column_spacing), float(row_spacing), slice_spacing],
    "sourcePixelSpacingMm": [float(row_spacing), float(column_spacing)],
    "sliceThicknessMm": float(pixel_measures[0].SliceThickness),
}
voxels.tofile("volume.bin")
Path("volume.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(f"Exported {depth} slices as a {width} × {height} × {depth} display volume.")
print(f"Slice spacing: {slice_spacing:.2f} mm.")
```

The final Three.js view pairs a rotatable volume with linked axial, coronal, and sagittal slices.

The axial view steps through the acquired images. The coronal view takes the same row from each image, and the sagittal view takes the same column. The crosshairs show where the three planes intersect, so a point in one view is easy to locate in the others.

{{< dicom-embed >}}

## More DICOM attributes

| DICOM attribute | Value | Meaning |
| --- | --- | --- |
| `MRAcquisitionType` | 2D | The scan was acquired as individual slices. |
| `BitsStored` | 12 bits | Source pixel precision before scaling to an 8-bit display volume. |
| `BitsAllocated` | 16 bits | Storage reserved for each pixel value. |
| `RepetitionTime` | 3960 ms | Time between sequence repetitions, shared across frames. |
| `EffectiveEchoTime` | 86.0 ms | Effective echo time recorded for the first frame. |
| `SliceThickness` | 5 mm | Nominal thickness of each slice. |
| `SpacingBetweenSlices` | 7 mm | Distance between neighbouring slice centres. |
