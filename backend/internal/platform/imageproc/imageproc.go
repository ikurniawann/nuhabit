// Package imageproc does in pure Go what the TS routes ask of sharp: decode
// (JPEG, PNG, GIF, WebP, BMP, TIFF), apply the EXIF orientation like
// sharp().rotate(), resize to fit, flatten and encode JPEG or PNG.
//
// Differences from sharp (libvips):
//   - WebP is decoded but not encoded: no pure-Go lossy WebP encoder exists.
//     Pipelines that ended in .webp() produce JPEG at the same quality and
//     report image/jpeg (Watermark), so callers set Content-Type from the
//     result.
//   - Resizing uses Catmull-Rom (bicubic); sharp defaults to Lanczos3.
//   - JPEG comes from image/jpeg (baseline, 4:2:0), not mozjpeg, so files
//     run about 10-20% larger at the same quality.
//   - HEIC/AVIF are not decoded (sharp's prebuilt libvips lacks them too).
//   - Animated GIF/WebP yield their first frame, as sharp does by default.
package imageproc

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	_ "image/gif" // decoder registration
	"image/jpeg"
	"image/png"

	xdraw "golang.org/x/image/draw"

	_ "golang.org/x/image/bmp"  // decoder registration
	_ "golang.org/x/image/tiff" // decoder registration
	_ "golang.org/x/image/webp" // decoder registration
)

// MaxPixels bounds decoding (sharp's default limitInputPixels).
const MaxPixels = 0x3FFF * 0x3FFF

// ErrTooLarge is an image over MaxPixels.
var ErrTooLarge = errors.New("imageproc: image exceeds pixel limit")

// Decode decodes data and applies its EXIF orientation, returning the
// upright image and the format name ("jpeg", "png", "gif", "webp", "bmp",
// "tiff").
func Decode(data []byte) (image.Image, string, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	if cfg.Width*cfg.Height > MaxPixels {
		return nil, "", ErrTooLarge
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	return orient(img, Orientation(data)), format, nil
}

// FitInside scales img down to fit maxW x maxH keeping the aspect ratio,
// like resize({width, height, fit: "inside", withoutEnlargement: true}). A
// zero bound is unconstrained; an image already inside is returned as is.
func FitInside(img image.Image, maxW, maxH int) image.Image {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	scale := 1.0
	if maxW > 0 && w > maxW {
		scale = float64(maxW) / float64(w)
	}
	if maxH > 0 && h > maxH {
		scale = min(scale, float64(maxH)/float64(h))
	}
	if scale >= 1 {
		return img
	}
	nw, nh := max(1, int(float64(w)*scale+0.5)), max(1, int(float64(h)*scale+0.5))
	dst := image.NewNRGBA(image.Rect(0, 0, nw, nh))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)
	return dst
}

// Flatten composites img over an opaque background, like
// flatten({background}).
func Flatten(img image.Image, bg color.Color) *image.RGBA {
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(bg), image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Over)
	return dst
}

// EncodeJPEG encodes img at quality 1-100. Transparent pixels come out
// black, as libvips drops the alpha channel.
func EncodeJPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	return buf.Bytes(), err
}

// EncodePNG encodes img losslessly.
func EncodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	err := png.Encode(&buf, img)
	return buf.Bytes(), err
}

// ThumbnailOptions describe a decode, fit, flatten and JPEG pipeline.
type ThumbnailOptions struct {
	MaxWidth, MaxHeight int
	// Background flattens transparency onto this color; nil leaves it to
	// EncodeJPEG (black).
	Background color.Color
	Quality    int
}

// JPEGThumbnail runs sharp(data).rotate().resize(fit inside, no
// enlargement)[.flatten()].jpeg({quality}):
//
//	gofood-image:           {MaxWidth: 1200, MaxHeight: 1200, Background: color.White, Quality: 85}
//	attendance photo in PDF: {MaxWidth: 480, Quality: 62}
func JPEGThumbnail(data []byte, o ThumbnailOptions) ([]byte, error) {
	img, _, err := Decode(data)
	if err != nil {
		return nil, err
	}
	img = FitInside(img, o.MaxWidth, o.MaxHeight)
	if o.Background != nil {
		img = Flatten(img, o.Background)
	}
	return EncodeJPEG(img, o.Quality)
}
