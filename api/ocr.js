// 명함 OCR 서버리스 함수 (Vercel Node.js)
//
// 폰에서 리사이즈한 명함 사진(base64)을 받아 Claude Vision으로 정보를 추출하고
// 구조화된 JSON을 돌려줍니다. ANTHROPIC_API_KEY 는 Vercel 환경변수에만 존재하며
// 폰(브라우저)에는 절대 노출되지 않습니다.

const SYSTEM_PROMPT = `당신은 명함 정보 추출 전문가입니다. 첨부된 명함 이미지에서 정보를 정확히 추출하세요.

규칙:
- 추측 금지: 명함에서 글자가 불분명하면 해당 필드를 빈 문자열("")로 둡니다.
- 명함에 없는 정보는 만들지 않습니다.
- 회사명은 명함에 적힌 그대로 유지합니다.
- 한국 이름은 성(lastName)과 이름(firstName)으로 분리합니다. 성이 2글자인 경우(예: 남궁, 선우)도 고려하세요.
- 전화번호는 모두 하이픈(-)으로 구분합니다.
  · 010으로 시작 → mobile
  · 02, 031 등 지역번호 → workPhone
  · Fax / 팩스 / F. → fax
- 부서가 있으면 department 에 넣습니다.`;

// 구조화 출력 스키마 — 모든 필드는 필수(값이 없으면 빈 문자열)
const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "전체 이름 (예: 이정원)" },
    lastName: { type: "string", description: "성 (예: 이)" },
    firstName: { type: "string", description: "이름 (예: 정원)" },
    org: { type: "string", description: "회사명" },
    department: { type: "string", description: "부서 (없으면 빈 문자열)" },
    title: { type: "string", description: "직책 (예: 사원, 대표이사)" },
    mobile: { type: "string", description: "휴대폰 010-XXXX-XXXX" },
    workPhone: { type: "string", description: "회사 전화 (지역번호)" },
    fax: { type: "string", description: "팩스" },
    email: { type: "string", description: "이메일" },
    url: { type: "string", description: "홈페이지" },
    address: { type: "string", description: "주소" },
    zipcode: { type: "string", description: "우편번호" },
    note: { type: "string", description: "기타 메모 (없으면 빈 문자열)" },
  },
  required: [
    "name", "lastName", "firstName", "org", "department", "title",
    "mobile", "workPhone", "fax", "email", "url", "address", "zipcode", "note",
  ],
  additionalProperties: false,
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다." });
    return;
  }

  try {
    // Vercel Node 함수는 application/json 본문을 자동 파싱합니다.
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { imageBase64, mediaType } = body;

    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 가 없습니다." });
      return;
    }

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType || "image/jpeg",
                  data: imageBase64,
                },
              },
              { type: "text", text: "이 명함에서 정보를 추출하세요." },
            ],
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      res.status(502).json({ error: "Claude API 오류", detail: errText });
      return;
    }

    const data = await anthropicResp.json();

    if (data.stop_reason === "refusal") {
      res.status(422).json({ error: "이미지를 처리할 수 없습니다." });
      return;
    }

    // 구조화 출력이므로 첫 text 블록이 유효한 JSON 입니다.
    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) {
      res.status(502).json({ error: "응답에서 텍스트를 찾지 못했습니다." });
      return;
    }

    const fields = JSON.parse(textBlock.text);
    res.status(200).json({ fields });
  } catch (err) {
    res.status(500).json({ error: "처리 중 오류", detail: String(err && err.message ? err.message : err) });
  }
};
