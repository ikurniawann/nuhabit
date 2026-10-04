package imageproc

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/draw"
)

// Orientation reads the EXIF orientation (1-8) from a JPEG APP1 segment, a
// PNG eXIf chunk or a WebP EXIF chunk; 1 when absent or unreadable.
func Orientation(data []byte) int {
	if tiff := exifTIFF(data); tiff != nil {
		if o := tiffOrientation(tiff); o >= 1 && o <= 8 {
			return o
		}
	}
	return 1
}

// exifTIFF returns the TIFF-structured EXIF payload of data, or nil.
func exifTIFF(data []byte) []byte {
	switch {
	case len(data) > 4 && data[0] == 0xff && data[1] == 0xd8:
		for i := 2; i+4 <= len(data) && data[i] == 0xff; {
			marker := data[i+1]
			if marker == 0xda || marker == 0xd9 { // start of scan, end of image
				return nil
			}
			n := int(binary.BigEndian.Uint16(data[i+2:]))
			seg := data[min(i+4, len(data)):min(i+2+n, len(data))]
			if marker == 0xe1 && bytes.HasPrefix(seg, []byte("Exif\x00\x00")) {
				return seg[6:]
			}
			i += 2 + n
		}
	case len(data) > 8 && bytes.HasPrefix(data, pngSignature):
		for i := 8; i+12 <= len(data); {
			n := int(binary.BigEndian.Uint32(data[i:]))
			typ := string(data[i+4 : i+8])
			if typ == "eXIf" && i+8+n <= len(data) {
				return data[i+8 : i+8+n]
			}
			if typ == "IDAT" {
				return nil
			}
			i += 12 + n
		}
	case len(data) > 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		for i := 12; i+8 <= len(data); {
			n := int(binary.LittleEndian.Uint32(data[i+4:]))
			if string(data[i:i+4]) == "EXIF" && i+8+n <= len(data) {
				return bytes.TrimPrefix(data[i+8:i+8+n], []byte("Exif\x00\x00"))
			}
			i += 8 + n + n%2
		}
	}
	return nil
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}

// tiffOrientation reads tag 0x0112 from IFD0.
func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 0
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 0
	}
	ifd := int(bo.Uint32(t[4:]))
	if ifd < 0 || ifd+2 > len(t) {
		return 0
	}
	count := int(bo.Uint16(t[ifd:]))
	for i := 0; i < count; i++ {
		e := ifd + 2 + i*12
		if e+12 > len(t) {
			return 0
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			return int(bo.Uint16(t[e+8:]))
		}
	}
	return 0
}

// orient returns img transformed so EXIF orientation o displays upright.
func orient(img image.Image, o int) image.Image {
	if o <= 1 || o > 8 {
		return img
	}
	b := img.Bounds()
	src := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(src, src.Bounds(), img, b.Min, draw.Src)
	w, h := b.Dx(), b.Dy()
	dw, dh := w, h
	if o >= 5 {
		dw, dh = h, w
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var dx, dy int
			switch o {
			case 2: // mirrored horizontally
				dx, dy = w-1-x, y
			case 3: // rotated 180
				dx, dy = w-1-x, h-1-y
			case 4: // mirrored vertically
				dx, dy = x, h-1-y
			case 5: // transposed
				dx, dy = y, x
			case 6: // stored 90 counter-clockwise, display rotates clockwise
				dx, dy = h-1-y, x
			case 7: // transversed
				dx, dy = h-1-y, w-1-x
			case 8: // stored 90 clockwise, display rotates counter-clockwise
				dx, dy = y, w-1-x
			}
			copy(dst.Pix[dst.PixOffset(dx, dy):][:4], src.Pix[src.PixOffset(x, y):][:4])
		}
	}
	return dst
}
