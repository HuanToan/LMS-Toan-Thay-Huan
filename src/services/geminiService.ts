/**
 * Gemini AI Service - AI Tutor cho LMS
 * Hỗ trợ học sinh và Giáo viên
 */
import { GoogleGenAI } from "@google/genai";
import { TutorContext, TutorResponse, Question, Theory } from '../types';

// API Key từ environment
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Track hint levels per question
const hintLevels: Map<string, number> = new Map();

/**
 * Lấy hint level hiện tại cho một câu hỏi
 */
export const getHintLevel = (questionId: string): number => {
  return hintLevels.get(questionId) || 0;
};

/**
 * Tăng hint level cho một câu hỏi
 */
export const incrementHintLevel = (questionId: string): number => {
  const current = getHintLevel(questionId);
  const newLevel = Math.min(current + 1, 3);
  hintLevels.set(questionId, newLevel);
  return newLevel;
};

/**
 * Reset hint level cho một câu hỏi
 */
export const resetHintLevel = (questionId: string): void => {
  hintLevels.delete(questionId);
};

/**
 * Reset tất cả hint levels
 */
export const resetAllHints = (): void => {
  hintLevels.clear();
};

/**
 * Helper: Clean and Parse JSON safely
 */
function safeJSONParse(text: string): any {
  if (!text) return {};
  
  // 1. Remove Markdown code blocks
  let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  
  try {
    return JSON.parse(cleanText);
  } catch (error) {
    console.warn('First JSON parse attempt failed, trying to sanitize backslashes...', error);
    // Nếu lỗi vẫn xảy ra, trả về null để UI xử lý (hiển thị lỗi hoặc thử lại)
    return null;
  }
}

/**
 * Helper: Tách ảnh base64 ra khỏi markdown để giảm token
 */
function extractImages(markdown: string): { cleanText: string; imageMap: Map<string, string> } {
  const imageMap = new Map<string, string>();
  let counter = 0;
  
  // Regex bắt pattern ![alt](data:image...)
  // Group 1: alt text, Group 2: data uri
  const cleanText = markdown.replace(/!\[(.*?)\]\((data:image\/[^)]+)\)/g, (match, alt, dataUri) => {
    const placeholder = `{{__IMG_${counter}__}}`;
    imageMap.set(placeholder, match); // Lưu lại toàn bộ tag ảnh gốc
    counter++;
    return placeholder; // Thay thế bằng placeholder trong text gửi đi
  });

  return { cleanText, imageMap };
}

/**
 * Helper: Khôi phục lại ảnh từ placeholder
 */
function restoreImages(text: string, imageMap: Map<string, string>): string {
  let restoredText = text;
  imageMap.forEach((originalImageTag, placeholder) => {
    // Thay thế tất cả các lần xuất hiện của placeholder (đề phòng model lặp lại)
    restoredText = restoredText.split(placeholder).join(originalImageTag);
  });
  return restoredText;
}

/**
 * Hỏi AI Tutor
 */
export const askAITutor = async (
  userMessage: string,
  context?: TutorContext
): Promise<TutorResponse> => {
  // Get current hint level
  const hintLevel = context?.questionId ? getHintLevel(context.questionId) : 0;
  
  // Build system prompt based on hint level
  const systemPrompt = buildSystemPrompt(hintLevel, context);
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Câu hỏi của học sinh: ${userMessage}`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
      },
    });
    
    const message = response.text;
    
    if (message) {
      // Increment hint level if this was a hint request
      if (context?.questionId && userMessage.toLowerCase().includes('gợi ý')) {
        incrementHintLevel(context.questionId);
      }
      
      return {
        message,
        hintLevel,
        isFullSolution: hintLevel >= 3
      };
    }
    
    return getFallbackResponse(hintLevel, context);
    
  } catch (error) {
    console.error('AI Tutor error:', error);
    return getFallbackResponse(hintLevel, context);
  }
};

/**
 * Tạo câu hỏi mới từ AI (Giáo viên)
 */
export const generateQuestionFromAI = async (
  grade: number,
  topic: string,
  level: string, // Nhận biết, Thông hiểu...
  type: 'Trắc nghiệm' | 'Đúng/Sai' | 'Trả lời ngắn',
  sourceText?: string // Nguồn văn bản (nếu có OCR)
): Promise<Partial<Question> | null> => {
  try {
    let prompt = `Tạo một câu hỏi toán học Lớp ${grade}, Chủ đề "${topic}", Mức độ "${level}", Dạng câu hỏi "${type}".\n`;
    
    if (sourceText) {
      // Nếu có sourceText (từ OCR), hãy tách ảnh ra để tránh lỗi token quá lớn khi generate
      const { cleanText } = extractImages(sourceText);
      prompt += `\n[QUAN TRỌNG] Dựa vào nội dung văn bản sau để tạo câu hỏi (có thể chỉnh sửa số liệu một chút để tạo biến thể):\n"""${cleanText}"""\n`;
    }

    prompt += `
    \n[YÊU CẦU ĐỊNH DẠNG JSON & LATEX - RẤT QUAN TRỌNG]:
    1. Output phải là một JSON Object hợp lệ (không dùng Markdown code block).
    2. TẤT CẢ các biểu thức toán học, biến số, phương trình phải viết dưới dạng LaTeX và đặt trong dấu $.
    3. QUAN TRỌNG: Trong chuỗi JSON, ký tự backslash (\\) của LaTeX phải được ESCAPE (viết thành \\\\).
       - SAI: "$\\frac{1}{2}$" (Lỗi JSON vì \\f là form feed hoặc \\ không hợp lệ)
       - ĐÚNG: "$\\\\frac{1}{2}$" (JSON hợp lệ)
       - SAI: "$\\alpha$"
       - ĐÚNG: "$\\\\alpha$"
       - SAI: "D = R \\ {1}"
       - ĐÚNG: "D = R \\\\setminus {1}"
    4. Hãy kiểm tra kỹ cú pháp JSON trước khi trả về.
    `;

    if (type === 'Trắc nghiệm') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi (LaTeX $\\\\dots$)",
        "option_A": "Đáp án A (LaTeX $\\\\dots$)",
        "option_B": "Đáp án B (LaTeX $\\\\dots$)",
        "option_C": "Đáp án C (LaTeX $\\\\dots$)",
        "option_D": "Đáp án D (LaTeX $\\\\dots$)",
        "answer_key": "A",
        "solution": "Lời giải chi tiết (LaTeX $\\\\dots$)"
      }`;
    } else if (type === 'Đúng/Sai') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi chính (LaTeX $\\\\dots$)",
        "option_A": "Mệnh đề a (LaTeX $\\\\dots$)",
        "option_B": "Mệnh đề b (LaTeX $\\\\dots$)",
        "option_C": "Mệnh đề c (LaTeX $\\\\dots$)",
        "option_D": "Mệnh đề d (LaTeX $\\\\dots$)",
        "answer_key": "Đ-S-Đ-S",
        "solution": "Giải thích từng mệnh đề (LaTeX $\\\\dots$)"
      }`;
    } else {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi (LaTeX $\\\\dots$)",
        "answer_key": "Giá trị số hoặc biểu thức ngắn gọn",
        "solution": "Lời giải chi tiết (LaTeX $\\\\dots$)"
      }`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7 // Giảm nhiệt độ để model tuân thủ format tốt hơn
      }
    });

    const json = safeJSONParse(response.text || '{}');
    if (!json) return null;

    return {
      ...json,
      grade,
      topic,
      level,
      question_type: type
    };

  } catch (error) {
    console.error('Gen Question Error:', error);
    return null;
  }
};

/**
 * Thực hiện OCR (Trích xuất văn bản từ file)
 */
export const performOCR = async (base64Data: string, mimeType: string): Promise<string | null> => {
  try {
    const prompt = `Hãy đóng vai trò là một công cụ OCR Toán học chuyên nghiệp. 
    Nhiệm vụ của bạn là trích xuất toàn bộ nội dung văn bản và công thức toán học từ hình ảnh/file PDF này.
    
    Yêu cầu:
    1. Giữ nguyên định dạng công thức toán học, chuyển đổi chúng sang định dạng LaTeX chuẩn (đặt trong dấu $...$ hoặc $$...$$).
    2. Nếu có nhiều câu hỏi, hãy trích xuất tất cả.
    3. Không thêm lời bình luận, chỉ trả về nội dung thô đã trích xuất.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          },
          { text: prompt }
        ]
      }
    });

    return response.text || null;
  } catch (error) {
    console.error('OCR Error:', error);
    return null;
  }
};

/**
 * 🆕 Correct OCR Text using Gemini (with Streaming)
 * Use for the new PDF Exam features
 * Updated: Handles large images by placeholder extraction
 */
export const correctTextStream = async (text: string, onUpdate: (chunk: string) => void): Promise<string> => {
  // 1. Tách ảnh để giảm token và tránh lỗi
  const { cleanText, imageMap } = extractImages(text);

  const prompt = `
    Bạn là chuyên gia biên tập tiếng Việt. Nhiệm vụ của bạn là sửa lỗi chính tả và ngữ pháp cho văn bản OCR sau đây.
    
    Yêu cầu QUAN TRỌNG:
    1. GIỮ NGUYÊN cấu trúc Markdown (tiêu đề, danh sách, bảng biểu, in đậm, in nghiêng).
    2. GIỮ NGUYÊN các placeholder hình ảnh dạng {{__IMG_x__}}. TUYỆT ĐỐI KHÔNG XOÁ HOẶC SỬA CHÚNG.
    3. GIỮ NGUYÊN các công thức LaTeX (dạng $...$ hoặc $$...$$).
    4. Chỉ sửa các từ bị sai chính tả, dấu câu sai, hoặc ngữ pháp lủng củng do quá trình OCR.
    5. KHÔNG thêm lời dẫn, KHÔNG giải thích. Chỉ trả về văn bản đã sửa.

    Văn bản gốc:
    """
    ${cleanText}
    """
  `;

  try {
    const result = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.1, // Low temp for consistency
        maxOutputTokens: 65536 // Increased to 65536 to handle large documents
      }
    });

    let fullText = '';
    for await (const chunk of result) {
      const chunkText = chunk.text;
      if (chunkText) {
        fullText += chunkText;
        onUpdate(chunkText); // Stream text (sẽ chứa placeholder)
      }
    }
    
    // 2. Khôi phục ảnh vào kết quả cuối cùng
    const finalText = restoreImages(fullText, imageMap);
    return finalText;
  } catch (error) {
    console.error("Error correcting text:", error);
    throw error;
  }
};

/**
 * 🆕 Parse Full Exam Markdown into Questions
 */
export const parseQuestionsFromMarkdown = async (markdownText: string, grade: number, topic: string): Promise<Partial<Question>[]> => {
  // Tách ảnh ra khỏi markdown trước khi gửi parse để tránh token limit
  const { cleanText, imageMap } = extractImages(markdownText);

  const prompt = `
    Bạn là hệ thống trích xuất đề thi Toán thông minh.
    Nhiệm vụ: Phân tích văn bản Markdown bên dưới và trích xuất TOÀN BỘ danh sách câu hỏi thành mảng JSON.
    Văn bản có thể chứa nhiều câu (VD: Câu 1 đến Câu 22). Hãy cố gắng không bỏ sót câu nào.

    [QUY TẮC PHÂN LOẠI CÂU HỎI]:
    Hãy xem xét các lựa chọn đáp án của từng câu hỏi để quyết định 'question_type':

    1. **Trắc nghiệm** (Multiple Choice):
       - Dấu hiệu: Có các lựa chọn bắt đầu bằng chữ cái IN HOA như A., B., C., D. (hoặc A:, B:, C:, D:).
       - Hành động:
         + type = "Trắc nghiệm"
         + Đưa nội dung sau A. vào field "option_A"
         + Đưa nội dung sau B. vào field "option_B" (tương tự C, D)

    2. **Đúng/Sai** (True/False):
       - Dấu hiệu: Có các ý nhỏ bắt đầu bằng chữ cái thường a), b), c), d) (hoặc a., b., c., d.).
       - Hành động:
         + type = "Đúng/Sai"
         + Đưa nội dung ý a) vào field "option_A"
         + Đưa nội dung ý b) vào field "option_B" (tương tự c, d)

    3. **Trả lời ngắn** (Short Answer):
       - Dấu hiệu: Không có các lựa chọn A/B/C/D hay a/b/c/d. Thường yêu cầu "Tính...", "Tìm...", "Cho biết...".
       - Hành động:
         + type = "Trả lời ngắn"
         + Các field option_A...D để trống hoặc null.

    [YÊU CẦU OUTPUT JSON]:
    - Output là một JSON Array: [ {...}, {...} ]
    - Các trường bắt buộc: "question_type", "question_text", "option_A", "option_B", "option_C", "option_D".
    - "answer_key": Nếu đề có đáp án, hãy điền (VD: "A", "Đ-S-S-Đ", hoặc "15"). Nếu không, để trống.
    - "solution": Lời giải chi tiết (nếu có).
    - "image_id": Nếu câu hỏi chứa hình ảnh ({{__IMG_x__}} hoặc ![...]), hãy trích xuất placeholder đó vào đây.
    - LaTeX phải được double-escape (\\\\frac instead of \\frac).

    [VĂN BẢN ĐỀ THI]:
    """
    ${cleanText}
    """
  `;

  try {
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: 65536 // Increased to 65536 to ensure full JSON extraction
        }
    });
    
    const parsed = safeJSONParse(response.text || '[]');
    if (!Array.isArray(parsed)) return [];
    
    // Restore images inside image_id if necessary
    return parsed.map((q: any) => {
        let fullImageTag = q.image_id;
        if (q.image_id && imageMap.has(q.image_id)) {
            fullImageTag = imageMap.get(q.image_id);
        }

        return {
            ...q,
            image_id: fullImageTag,
            grade,
            topic,
            level: 'Thông hiểu',
            quiz_level: 1
        };
    });
  } catch (error) {
    console.error("Error parsing questions:", error);
    return [];
  }
};

/**
 * Tạo Lý thuyết từ AI (Giáo viên)
 */
export const generateTheoryFromAI = async (
  grade: number,
  topic: string,
  level: number
): Promise<Partial<Theory> | null> => {
  try {
    const prompt = `Soạn tài liệu lý thuyết toán học ngắn gọn.
    Lớp: ${grade}
    Chủ đề: ${topic}
    Level: ${level} (Càng cao càng nâng cao)

    [YÊU CẦU ĐỊNH DẠNG JSON & LATEX]:
    1. Output là JSON Object hợp lệ.
    2. Mọi công thức toán phải viết bằng LaTeX trong dấu $...$ hoặc $$...$$.
    3. ESCAPE dấu backslash: Dùng \\\\frac thay vì \\frac trong chuỗi JSON.

    Yêu cầu output JSON format:
    {
      "title": "Tiêu đề bài học (Ngắn gọn)",
      "content": "Nội dung lý thuyết chính. Dùng LaTeX (\\\\frac, \\\\alpha...) cho công thức.",
      "examples": "1-2 Ví dụ minh họa. Dùng LaTeX.",
      "tips": "Mẹo ghi nhớ."
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    });

    const json = safeJSONParse(response.text || '{}');
    if (!json) return null;

    return {
      ...json,
      grade,
      topic,
      level
    };

  } catch (error) {
    console.error('Gen Theory Error:', error);
    return null;
  }
};

/**
 * Build system prompt based on hint level
 */
function buildSystemPrompt(hintLevel: number, context?: TutorContext): string {
  const basePrompt = `Bạn là "Trợ Lý Thầy Phúc", một gia sư Toán học thân thiện và kiên nhẫn.
Bạn đang giúp học sinh cấp 3 ở Việt Nam.
Hãy trả lời bằng tiếng Việt, sử dụng công thức LaTeX khi cần (đặt trong dấu $).
`;

  let levelPrompt = '';
  
  switch (hintLevel) {
    case 0:
      levelPrompt = `
🔹 ĐÂY LÀ GỢI Ý CẤP 0 (Tổng quan):
- Chỉ đưa ra hướng tiếp cận chung
- KHÔNG giải bài hoặc đưa ra các bước cụ thể
- Gợi ý về loại bài toán và phương pháp nên dùng
- Khuyến khích học sinh tự suy nghĩ
- Ví dụ: "Đây là bài về đạo hàm, em thử nhớ lại công thức đạo hàm của hàm số mũ nhé!"
`;
      break;
      
    case 1:
      levelPrompt = `
🔸 ĐÂY LÀ GỢI Ý CẤP 1 (Bước đầu):
- Đưa ra bước đầu tiên cần làm
- Nhắc lại công thức/định lý liên quan
- Vẫn để học sinh tự thực hiện các bước tiếp theo
- Ví dụ: "Bước 1 là tính đạo hàm. Công thức: $(e^x)' = e^x$. Em thử tính đạo hàm của hàm số này xem."
`;
      break;
      
    case 2:
      levelPrompt = `
🔶 ĐÂY LÀ GỢI Ý CẤP 2 (Chi tiết):
- Hướng dẫn từng bước nhưng không đưa kết quả cuối
- Giúp loại trừ các đáp án sai
- Giải thích tại sao một số đáp án không đúng
- Ví dụ: "Ta có $f'(x) = ...$, đáp án A và C có thể loại vì... Em thử xét tiếp đáp án còn lại."
`;
      break;
      
    case 3:
      levelPrompt = `
🔴 ĐÂY LÀ GỢI Ý CẤP 3 (Lời giải đầy đủ):
- Giải chi tiết từng bước
- Đưa ra đáp án đúng
- Giải thích tại sao các đáp án khác sai
- Tổng kết kiến thức cần nhớ
- ⚠️ Nhắc nhở học sinh nên tự làm lại bài tương tự để hiểu sâu hơn
`;
      break;
  }
  
  let contextPrompt = '';
  if (context) {
    contextPrompt = `
📝 THÔNG TIN BÀI TOÁN:
- Câu hỏi: ${context.questionText || 'Không có'}
- Các đáp án: ${context.options?.join(', ') || 'Không có'}
- Học sinh đã chọn: ${context.userAnswer || 'Chưa chọn'}
- Đáp án đúng: ${context.correctAnswer || 'Không tiết lộ ở level này'}
`;
  }
  
  return basePrompt + levelPrompt + contextPrompt;
}

/**
 * Fallback response khi không có API hoặc lỗi
 */
function getFallbackResponse(hintLevel: number, context?: TutorContext): TutorResponse {
  const fallbacks = [
    // Level 0
    "Hãy đọc kỹ đề bài và xác định dạng toán trước nhé em! Đây là bước quan trọng nhất. 📚",
    // Level 1
    "Em hãy thử viết ra các công thức liên quan đến bài này. Gợi ý: Xem lại phần lý thuyết về chủ đề này trong sách giáo khoa. ✏️",
    // Level 2  
    "Thử loại trừ các đáp án chắc chắn sai trước. Kiểm tra xem đáp án nào thỏa mãn điều kiện của đề bài. 🔍",
    // Level 3
    "Hiện tại thầy đang bận, em có thể xem lời giải chi tiết sau khi nộp bài nhé! Hoặc hỏi lại thầy sau. 📖"
  ];
  
  return {
    message: fallbacks[Math.min(hintLevel, 3)],
    hintLevel,
    isFullSolution: hintLevel >= 3
  };
}

/**
 * Giải thích đáp án sai sau khi quiz kết thúc
 */
export const explainWrongAnswer = async (
  questionText: string,
  options: string[],
  userAnswer: string,
  correctAnswer: string
): Promise<string> => {
  try {
    const prompt = `
Bạn là gia sư Toán. Học sinh đã trả lời SAI một câu hỏi.
Hãy giải thích ngắn gọn (2-3 câu) tại sao đáp án của học sinh sai và tại sao đáp án đúng là ${correctAnswer}.

Câu hỏi: ${questionText}
Các đáp án: ${options.join(', ')}
Học sinh chọn: ${userAnswer}
Đáp án đúng: ${correctAnswer}

Trả lời bằng tiếng Việt, sử dụng LaTeX khi cần (đặt trong $).
`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            temperature: 0.5,
        }
    });
    
    return response.text || `Đáp án đúng là ${correctAnswer}. Xem lời giải chi tiết để hiểu rõ hơn nhé!`;
    
  } catch (error) {
    console.error('Explain error:', error);
    return `Đáp án đúng là ${correctAnswer}. Xem lời giải chi tiết để hiểu rõ hơn nhé!`;
  }
};

/**
 * Lấy gợi ý nhanh (1 câu)
 */
export const getQuickHint = async (questionText: string): Promise<string> => {
  try {
    const prompt = `
Bạn là gia sư Toán. Cho gợi ý NGẮN GỌN (1 câu) về cách tiếp cận bài toán này.
KHÔNG giải bài, chỉ gợi ý hướng đi.

Câu hỏi: ${questionText}

Trả lời bằng tiếng Việt, sử dụng LaTeX khi cần (đặt trong $).
`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
            temperature: 0.7,
        }
    });
    
    return response.text || "Hãy xác định dạng toán và công thức cần dùng! 📝";
    
  } catch (error) {
    return "Đọc kỹ đề và xác định dạng toán trước nhé! 📚";
  }
};