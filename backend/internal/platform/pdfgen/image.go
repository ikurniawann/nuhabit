package pdfgen

import (
	"bytes"
	"errors"
	"strconv"

	"github.com/go-pdf/fpdf"

	"nuhabit/backend/internal/platform/imageproc"
)

// Image draws data fitted inside the w x h box at (x, y), centered, like
// doc.image(data, x, y, {fit: [w, h], align: "center", valign: "center"}).
// An upright JPEG embeds as is; anything else imageproc decodes (PNG, GIF,
// WebP, BMP, TIFF, EXIF-rotated JPEG) embeds as PNG, so WebP selfies need
// no conversion first. A bad image returns an error and leaves the
// document usable, so the caller can draw a placeholder.
func (d *Doc) Image(data []byte, x, y, w, h float64) error {
	kind := "JPG"
	if !isJPEG(data) || imageproc.Orientation(data) != 1 {
		img, _, err := imageproc.Decode(data)
		if err != nil {
			return err
		}
		if data, err = imageproc.EncodePNG(img); err != nil {
			return err
		}
		kind = "PNG"
	}
	d.images++
	name := "img" + strconv.Itoa(d.images)
	info := d.pdf.RegisterImageOptionsReader(name, fpdf.ImageOptions{ImageType: kind}, bytes.NewReader(data))
	if d.pdf.Err() {
		err := d.pdf.Error()
		d.pdf.ClearError()
		return err
	}
	if info == nil || info.Width() <= 0 || info.Height() <= 0 {
		return errors.New("pdfgen: empty image")
	}
	scale := min(w/info.Width(), h/info.Height())
	iw, ih := info.Width()*scale, info.Height()*scale
	d.pdf.ImageOptions(name, x+(w-iw)/2, y+(h-ih)/2, iw, ih, false, fpdf.ImageOptions{ImageType: kind}, 0, "")
	return nil
}

func isJPEG(b []byte) bool { return len(b) > 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff }
