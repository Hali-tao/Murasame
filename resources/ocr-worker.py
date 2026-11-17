"""Pinned RapidOCR/ONNX CPU worker. PNG input and OCR output stay in memory."""
import base64
import json
import pathlib
import socket
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.dont_write_bytecode = True


def deny_network(*args, **kwargs):
    raise RuntimeError("OCR recognition is offline; missing files must be installed first")


def main():
    # No network, including implicit dictionary/model downloads by upstream code.
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.create_connection = deny_network
    import cv2
    import numpy as np
    from rapidocr import RapidOCR, OCRVersion, ModelType

    root = pathlib.Path(sys.argv[1]).resolve()
    for file in ("det.onnx", "rec.onnx"):
        if not (root / file).is_file():
            raise FileNotFoundError(file)
    engine = RapidOCR(params={
        "Global.model_root_dir": str(root),
        "Global.use_cls": False,
        "Global.log_level": "critical",
        "Det.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE,
        "Det.model_path": str(root / "det.onnx"),
        "Det.limit_side_len": 1280,
        "Det.limit_type": "max",
        "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_type": ModelType.MOBILE,
        "Rec.model_path": str(root / "rec.onnx"),
        "EngineConfig.onnxruntime.intra_op_num_threads": 2,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })
    # Loading both models is required for a successful installation/check.
    engine._load_det_model()
    engine._load_rec_model()
    if "--probe" in sys.argv:
        print(json.dumps({"ok": True, "text": ""}))
        return
    raw = sys.stdin.buffer.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024:
        raise ValueError("Screenshot exceeds OCR input limit")
    data = base64.b64decode(raw, validate=True)
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] * image.shape[1] > 40_000_000:
        raise ValueError("Invalid or oversized screenshot")
    result = engine(image)
    print(json.dumps({"ok": True, "text": "\n".join(result.txts or [])}, ensure_ascii=False))


try:
    main()
except Exception as error:
    # Never echo the input image or any OCR content on failure.
    print(json.dumps({"ok": False, "error": type(error).__name__}, ensure_ascii=False))
    sys.exit(1)
