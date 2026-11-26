# DICOM volume viewer

This viewer accompanies the Understanding DICOM draft. It uses `IMG-0001-00001.dcm`, the T2 TSE tra example from the [Siemens Healthineers DICOM Image Gallery](https://www.magnetomworld.siemens-healthineers.com/korean-dicom-image-gallery).

To enable the interactive viewer in a local draft build, run these commands from the repository root with the path to the downloaded DICOM file.

```bash
npm ci --prefix tools/dicom-viewer
uv run tools/dicom-viewer/export_volume.py /path/to/IMG-0001-00001.dcm --output tools/dicom-viewer
hugo server --buildDrafts --renderToMemory
```

Keep the DICOM file and generated volume files local. The draft renders its static frame grid on a clean checkout.
