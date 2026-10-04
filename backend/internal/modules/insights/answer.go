package insights

import (
	"context"
	"encoding/json"
	"slices"
	"strings"

	"nuhabit/backend/internal/modules/insights/domain"
)

// generateAnswer (lib/assistant/llm.ts): build the prompt, run up to three
// non-streaming tool rounds when project data is in scope, then answer
// (streamed when onDelta is set, retried once without streaming), falling
// back to the internal summary when the provider is unreachable.

type askInput struct {
	message     string
	history     []domain.ChatMessage
	summary     domain.Summary
	fallback    string
	userName    string
	intent      domain.Intent
	scope       domain.Scope
	model       string
	attachments []domain.Attachment
	action      actionCtx
	allow       []string
	onDelta     func(string)
}

type llmResult struct {
	answer, mode, model, status string
	fallbackReason, errorDetail string
	pending                     *pendingAction
}

const maxToolRounds = 3

var systemPromptLines = []string{
	"Kamu adalah Do, asisten NüHabit OS untuk semua user NüHabit OS.",
	"Perkenalkan dirimu sebagai Do. Jangan menyebut vendor atau nama model di balik layar kecuali user bertanya langsung.",
	"", // scope instruction
	"Jawab dalam Bahasa Indonesia yang ramah, jelas, natural, dan actionable.",
	"Gunakan bahasa awam seperti asisten operasional, bukan bahasa developer.",
	"Jangan menyebut JSON, API, query, schema, database, payload, object, array, model, prompt, system, atau istilah teknis internal kecuali user secara eksplisit meminta penjelasan teknis.",
	"Jika user bertanya data bisnis NüHabit OS, gunakan data internal yang tersedia dan jangan mengarang angka.",
	"Kamu punya alat untuk mengambil data terkini (karyawan, absensi, stok, penjualan, kandidat). Pakai alat itu bila pertanyaannya spesifik, jangan menebak dari ringkasan.",
	"Kamu juga bisa MENYIAPKAN aksi tertentu (membuat draft pengumuman, mencatat catatan kandidat). Aksi itu tidak pernah berjalan otomatis: sistem menampilkan kartu konfirmasi dan user harus menekan tombolnya sendiri. Setelah menyiapkan aksi, minta user memeriksa kartu konfirmasi di bawah jawabanmu, dan jangan pernah mengklaim aksinya sudah dijalankan.",
	"Jika data yang diperlukan tidak tersedia, cukup katakan data tersebut belum tersedia di sistem dan sarankan module atau filter yang perlu dibuka.",
	"Jika menjawab angka atau ringkasan, jelaskan artinya dalam konteks bisnis secara singkat.",
	"Ingat konteks percakapan dari history yang diberikan.",
	"Gunakan teks polos saja. Jangan gunakan markdown untuk bold, italic, heading, blockquote, atau tabel.",
}

func message(role string, content any) domain.Object {
	return domain.Object{{Key: "role", Value: role}, {Key: "content", Value: content}}
}

func buildMessages(in askInput) []domain.Object {
	system := slices.Clone(systemPromptLines)
	system[2] = domain.BuildScopeInstruction(in.scope)

	attachments := ""
	if len(in.attachments) > 0 {
		parts := make([]string, len(in.attachments))
		for i, a := range in.attachments {
			cut := ""
			if a.Truncated {
				cut = " (dipotong karena panjang)"
			}
			parts[i] = "--- " + a.Name + cut + " ---\n" + a.Text
		}
		attachments = "\nIsi lampiran yang dikirim user (sudah diekstrak; gambar & PDF hasil scan lewat OCR sehingga bisa ada salah baca):\n" + strings.Join(parts, "\n\n")
	}
	projectContext := "\nKonteks operasional NüHabit OS tidak dikirim untuk mode General Chat."
	if in.scope != domain.ScopeGeneral {
		raw, _ := domain.MarshalIndent(domain.SelectContextForIntent(in.summary, in.intent))
		projectContext = "\nKonteks internal NüHabit OS yang tersedia jika relevan:\n" + string(raw)
	}
	user := strings.Join([]string{
		"Nama user: " + in.userName,
		"Mode konteks: " + string(in.scope),
		"Intent terdeteksi: " + string(in.intent),
		"Pertanyaan user: " + in.message,
		attachments,
		projectContext,
	}, "\n")

	messages := []domain.Object{message("system", strings.Join(system, " "))}
	for _, h := range in.history {
		messages = append(messages, message(h.Role, h.Content))
	}
	return append(messages, message("user", user))
}

func (s *Service) generateAnswer(ctx context.Context, in askInput) llmResult {
	messages := buildMessages(in)
	var toolsUsed []string
	var pending *pendingAction
	// General chat gets no operational tools.
	if in.scope != domain.ScopeGeneral {
		var err error
		messages, toolsUsed, pending, err = s.toolRounds(ctx, in, messages)
		if err != nil {
			s.log.WarnContext(ctx, "[do:tool] putaran tool gagal", "error", providerError(err, "openai-tools"))
		}
	}
	suffix := ""
	if len(toolsUsed) > 0 {
		var unique []string
		for _, t := range toolsUsed {
			if !slices.Contains(unique, t) {
				unique = append(unique, t)
			}
		}
		suffix = "_tools:" + strings.Join(unique, "+")
	}

	if in.onDelta != nil {
		answer, err := s.llm.chatStream(ctx, s.db, in.model, messages, in.onDelta)
		if err == nil {
			return llmResult{answer: answer, mode: "openai_stream_live" + suffix, model: in.model, status: "live", pending: pending}
		}
		s.log.WarnContext(ctx, "AI assistant stream gagal, coba non-stream", "error", providerError(err, "openai-stream"))
	}
	answer, err := s.llm.chat(ctx, s.db, in.model, messages)
	if err == nil {
		return llmResult{answer: answer, mode: "openai_chat_completions_live" + suffix, model: in.model, status: "live", pending: pending}
	}
	detail := providerError(err, "openai")
	s.log.WarnContext(ctx, "AI assistant OpenAI fallback", "error", detail)
	return llmResult{
		answer: in.fallback, mode: "openai_unavailable_fallback", model: in.model, status: "fallback",
		fallbackReason: "Do sedang tidak bisa menjangkau layanan AI. Saya memakai ringkasan internal sementara.",
		errorDetail:    detail,
	}
}

type toolCall struct {
	ID       json.RawMessage `json:"id"`
	Function *struct {
		Name      any `json:"name"`
		Arguments any `json:"arguments"`
	} `json:"function"`
}

// toolRounds is runToolRounds. On error the messages gathered so far are
// dropped, as the TS continues with the original prompt.
func (s *Service) toolRounds(ctx context.Context, in askInput, messages []domain.Object) ([]domain.Object, []string, *pendingAction, error) {
	call, err := s.llm.resolve(ctx, s.db)
	if err != nil {
		return messages, nil, nil, err
	}
	// The model is only offered the tools this user may use.
	tools := []domain.ToolDef{}
	for _, d := range append(slices.Clone(domain.ReadToolDefs), domain.WriteToolDefs...) {
		if slices.Contains(in.allow, d.Function.Name) {
			tools = append(tools, d)
		}
	}
	working := slices.Clone(messages)
	var used []string
	var pending *pendingAction
	for range maxToolRounds {
		res, err := s.llm.complete(ctx, call, chatBody(in.model, domain.Object{{Key: "tools", Value: tools}}, working))
		if err != nil {
			return messages, nil, nil, err
		}
		content, rawCalls := res.message()
		var calls []json.RawMessage
		_ = json.Unmarshal(rawCalls, &calls)
		if len(calls) == 0 {
			return working, used, pending, nil
		}
		// The assistant message carrying tool_calls must precede their results.
		if len(content) == 0 {
			content = json.RawMessage("null")
		}
		working = append(working, domain.Object{{Key: "role", Value: "assistant"}, {Key: "content", Value: content}, {Key: "tool_calls", Value: rawCalls}})

		for _, raw := range calls {
			var c toolCall
			_ = json.Unmarshal(raw, &c)
			name, args := "", map[string]any{}
			if c.Function != nil {
				name, _ = c.Function.Name.(string)
				args = domain.ParseToolArguments(c.Function.Arguments)
			}
			var result any
			switch {
			case !slices.Contains(in.allow, name):
				// The model may invent a tool outside the offered list.
				result = errorResult("Alat ini di luar hak akses Anda.")
			case domain.IsWriteAction(name):
				// Write tools only create a pending proposal, one per turn.
				if pending != nil {
					result = errorResult("Sudah ada aksi lain yang menunggu konfirmasi user pada giliran ini.")
				} else if p, msg := s.proposeWriteAction(ctx, name, args, in.action); p != nil {
					pending = p
					result = domain.Object{
						{Key: "status", Value: "menunggu_konfirmasi_user"},
						{Key: "ringkasan", Value: p.Summary},
						{Key: "instruksi", Value: "Aksi BELUM dijalankan. User harus menekan tombol konfirmasi pada kartu yang muncul di layar. " +
							"Sampaikan ke user untuk memeriksa kartu konfirmasi, dan JANGAN mengklaim aksi sudah dijalankan."},
					}
				} else {
					result = errorResult(msg)
				}
			default:
				result = s.runTool(ctx, name, args)
			}
			used = append(used, name)
			argsJSON, _ := domain.Marshal(args)
			s.log.InfoContext(ctx, "[do:tool] "+name+" "+string(argsJSON))
			out, _ := domain.Marshal(result)
			msg := domain.Object{{Key: "role", Value: "tool"}}
			if len(c.ID) > 0 {
				msg = append(msg, domain.Field{Key: "tool_call_id", Value: c.ID})
			}
			working = append(working, append(msg, domain.Field{Key: "name", Value: name}, domain.Field{Key: "content", Value: string(out)}))
		}
	}
	s.log.WarnContext(ctx, "[do:tool] batas putaran tool tercapai")
	return working, used, pending, nil
}
