/**
 * Gemini AI Service - AI Tutor cho LMS
 * Hỗ trợ học sinh và Giáo viên
 */
import { GoogleGenAI } from "@google/genai";
import { TutorContext, TutorResponse, Question } from '../types';

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
 * Hỏi AI Tutor (Học sinh)
 */
export const askAITutor = async (
  userMessage: string,
  context?: TutorContext
): Promise<TutorResponse> => {
  const hintLevel = context?.questionId ? getHintLevel(context.questionId) : 0;
  const systemPrompt = buildSystemPrompt(hintLevel, context);
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Câu hỏi của học sinh: ${userMessage}`,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 2000,
      },
    });
    
    if (context?.questionId && userMessage.toLowerCase().includes('gợi ý')) {
      incrementHintLevel(context.questionId);
    }
    
    return {
      message: response.text || "Thầy đang suy nghĩ, em đợi chút nhé...",
      hintLevel,
      isFullSolution: hintLevel >= 3
    };
  } catch (error) {
    console.error('AI Error:', error);
    return {
      message: "Hệ thống AI đang bảo trì. Em hãy thử lại sau nhé.",
      hintLevel,
      isFullSolution: false
    };
  }
};

/**
 * Tạo câu hỏi mới từ AI (Giáo viên)
 */
export const generateQuestionFromAI = async (
  grade: number,
  topic: string,
  level: string, // Nhận biết, Thông hiểu...
  type: 'Trắc nghiệm' | 'Đúng/Sai' | 'Trả lời ngắn'
): Promise<Partial<Question> | null> => {
  try {
    let prompt = `Tạo một câu hỏi toán học Lớp ${grade}, Chủ đề "${topic}", Mức độ "${level}", Dạng câu hỏi "${type}".\n`;
    
    if (type === 'Trắc nghiệm') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi (dùng LaTeX trong $...$)",
        "option_A": "Đáp án A",
        "option_B": "Đáp án B",
        "option_C": "Đáp án C",
        "option_D": "Đáp án D",
        "answer_key": "A",
        "solution": "Lời giải chi tiết"
      }`;
    } else if (type === 'Đúng/Sai') {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi chính",
        "option_A": "Mệnh đề a",
        "option_B": "Mệnh đề b",
        "option_C": "Mệnh đề c",
        "option_D": "Mệnh đề d",
        "answer_key": "Đ-S-Đ-S",
        "solution": "Giải thích từng mệnh đề"
      }`;
    } else {
      prompt += `Yêu cầu output JSON format:
      {
        "question_text": "Nội dung câu hỏi",
        "answer_key": "Giá trị số hoặc biểu thức ngắn gọn",
        "solution": "Lời giải chi tiết"
      }`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.8
      }
    });

    const json = JSON.parse(response.text || '{}');
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

// ... (Các hàm helper khác giữ nguyên: buildSystemPrompt, explainWrongAnswer, getQuickHint)

function buildSystemPrompt(hintLevel: number, context?: TutorContext): string {
  // (Giữ nguyên nội dung như phiên bản trước)
  const base = `Bạn là Trợ Lý Thầy Phúc. Hỗ trợ học sinh giải toán. Dùng LaTeX $...$ cho công thức.`;
  const contextInfo = context ? `\nBài toán: ${context.questionText}\n` : '';
  const levelInfo = [
    "Chỉ gợi ý hướng đi, không giải bài.",
    "Gợi ý công thức cần dùng.",
    "Hướng dẫn từng bước, chưa ra đáp số.",
    "Giải chi tiết và ra đáp số."
  ];
  return `${base}\n${contextInfo}\nLevel hỗ trợ: ${levelInfo[hintLevel]}`;
}
