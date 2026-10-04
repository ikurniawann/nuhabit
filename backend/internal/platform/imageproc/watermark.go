package imageproc

import (
	"image"
	"image/color"
	"image/draw"
	"math"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

// Watermark is applyImageWatermark in lib/dataroom/watermark.ts: the image
// is auto-oriented and covered with the text repeated diagonally (-30°),
// white at 35% opacity with a dark 22% shadow, in tiles sized from the
// image. It returns the encoded image and its MIME type: PNG stays PNG,
// JPEG and WebP come out as JPEG quality 88 (sharp kept WebP as WebP; see
// the package doc). The font is Go Bold, standing in for Helvetica Bold.
func Watermark(data []byte, mime, text string) ([]byte, string, error) {
	img, _, err := Decode(data)
	if err != nil {
		return nil, "", err
	}
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Src)
	tile, err := watermarkTile(b.Dx(), b.Dy(), text)
	if err != nil {
		return nil, "", err
	}
	overlayPattern(dst, tile, -30)
	if mime == "image/png" {
		out, err := EncodePNG(dst)
		return out, "image/png", err
	}
	out, err := EncodeJPEG(dst, 88)
	return out, "image/jpeg", err
}

// watermarkTile renders one pattern cell of watermarkTileSvg.
func watermarkTile(width, height int, text string) (*image.RGBA, error) {
	size := math.Max(14, math.Round(float64(min(width, height))/22))
	tileW := int(math.Round(float64(utf16Len(text))*size*0.62 + size*3))
	tileH := int(math.Round(size * 5))
	f, err := opentype.Parse(gobold.TTF)
	if err != nil {
		return nil, err
	}
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: size, DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		return nil, err
	}
	defer face.Close()
	tile := image.NewRGBA(image.Rect(0, 0, tileW, tileH))
	y := math.Round(float64(tileH) / 2)
	layers := []struct {
		dx, dy float64
		c      color.NRGBA
	}{
		{size, y, color.NRGBA{0xff, 0xff, 0xff, 89}},         // #ffffff, fill-opacity 0.35
		{size - 1, y - 1, color.NRGBA{0x11, 0x11, 0x11, 56}}, // #111111, fill-opacity 0.22
	}
	for _, l := range layers {
		d := font.Drawer{Dst: tile, Src: image.NewUniform(l.c), Face: face,
			Dot: fixed.Point26_6{X: fixed.Int26_6(l.dx * 64), Y: fixed.Int26_6(l.dy * 64)}}
		d.DrawString(text)
	}
	return tile, nil
}

// overlayPattern composites tile, repeated and rotated by deg (SVG
// patternTransform rotate), over dst with bilinear sampling.
func overlayPattern(dst *image.RGBA, tile *image.RGBA, deg float64) {
	// Pattern space is user space rotated by deg, so p = R(-deg)·u.
	sin, cos := math.Sincos(-deg * math.Pi / 180)
	tw, th := float64(tile.Bounds().Dx()), float64(tile.Bounds().Dy())
	b := dst.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			ux, uy := float64(x)+0.5, float64(y)+0.5
			px := wrap(ux*cos-uy*sin-0.5, tw)
			py := wrap(ux*sin+uy*cos-0.5, th)
			r, g, bl, a := bilinear(tile, px, py)
			if a == 0 {
				continue
			}
			i := dst.PixOffset(x, y)
			p := dst.Pix[i : i+4 : i+4]
			inv := 1 - a/255
			p[0] = uint8(r + float64(p[0])*inv + 0.5)
			p[1] = uint8(g + float64(p[1])*inv + 0.5)
			p[2] = uint8(bl + float64(p[2])*inv + 0.5)
			p[3] = uint8(a + float64(p[3])*inv + 0.5)
		}
	}
}

func wrap(v, n float64) float64 {
	v = math.Mod(v, n)
	if v < 0 {
		v += n
	}
	return v
}

// bilinear samples premultiplied RGBA at (x, y), wrapping at the edges.
func bilinear(img *image.RGBA, x, y float64) (r, g, b, a float64) {
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	x0, y0 := int(x), int(y)
	fx, fy := x-float64(x0), y-float64(y0)
	x1, y1 := (x0+1)%w, (y0+1)%h
	for _, s := range [4]struct {
		x, y int
		wt   float64
	}{{x0, y0, (1 - fx) * (1 - fy)}, {x1, y0, fx * (1 - fy)}, {x0, y1, (1 - fx) * fy}, {x1, y1, fx * fy}} {
		p := img.Pix[img.PixOffset(s.x, s.y):]
		r += float64(p[0]) * s.wt
		g += float64(p[1]) * s.wt
		b += float64(p[2]) * s.wt
		a += float64(p[3]) * s.wt
	}
	return
}

// utf16Len is JavaScript's string length.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xffff {
			n++
		}
	}
	return n
}
