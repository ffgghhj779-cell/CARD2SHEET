import io
from PIL import Image, ImageOps

MAX_SIDE = 2400


def prepare_image(data: bytes) -> bytes:
    """Fix EXIF rotation, downscale huge photos, mild contrast boost -> JPEG bytes.

    90/180-degree rotations without EXIF and skew are handled by the vision model
    (the prompt instructs it to mentally rotate and read in any orientation).
    """
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=1)  # helps with shadows / washed-out glare
    out = io.BytesIO()
    img.save(out, "JPEG", quality=92)
    return out.getvalue()
