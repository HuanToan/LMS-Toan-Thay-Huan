/**
 * Sheet Service - Kết nối với Google Apps Script Backend
 * LMS Thầy Phúc - Toán Đồng Nai
 * Version 3.0 - CORS Fixed
 */

import { 
  User, 
  Question, 
  Theory,
  QuizResult, 
  Session, 
  SessionValidation,
  LeaderboardEntry,
  TopicProgress
} from '../types';

// ==================== CONFIGURATION ====================

// 🔴 QUAN TRỌNG: Thay URL này bằng URL Web App của bạn sau khi deploy code.gs
export const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxP2QiOi6tIEYxxG-AO1i6PV_QGaQueLQwhtMpPVuKiWfWkHPvLt3H71yme6DhGuyEKxg/exec';

// API Response interface
interface APIResponse<T = unknown> {
  status: 'success' | 'error';
  data: T;
  message?: string;
  timestamp?: string;
}

// ==================== CORE API HELPER ====================

/**
 * Gọi API bằng GET request để tránh CORS preflight
 * Tất cả data được gửi qua URL params
 */
async function callAPI<T>(action: string, data: Record<string, unknown> = {}): Promise<APIResponse<T>> {
  try {
    // Build URL với params
    const params = new URLSearchParams({
      action,
      payload: JSON.stringify(data)
    });
    
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    
    console.log(`[API] ${action}:`, data);
    
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow' // Quan trọng: Google Apps Script redirect response
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const json: APIResponse<T> = await response.json();
    
    console.log(`[API] ${action} response:`, json);
    
    return json;
  } catch (error) {
    console.error(`[API] ${action} error:`, error);
    return {
      status: 'error',
      data: null as T,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Gọi API với retry logic
 */
async function callAPIWithRetry<T>(
  action: string, 
  data: Record<string, unknown> = {}, 
  maxRetries: number = 2
): Promise<APIResponse<T>> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await callAPI<T>(action, data);
      
      // Nếu thành công hoặc lỗi logic (không phải network error), return ngay
      if (result.status === 'success' || !result.message?.includes('fetch')) {
        return result;
      }
      
      lastError = new Error(result.message);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
    }
    
    // Đợi trước khi retry (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      console.log(`[API] Retrying ${action} (attempt ${attempt + 2}/${maxRetries + 1})`);
    }
  }
  
  return {
    status: 'error',
    data: null as T,
    message: lastError?.message || 'Max retries exceeded'
  };
}

// ==================== DEVICE & SESSION STORAGE ====================

/**
 * Tạo hoặc lấy Device ID
 */
const getDeviceId = (): string => {
  const key = 'lms_device_id';
  let deviceId = localStorage.getItem(key);
  
  if (!deviceId) {
    deviceId = 'device_' + Math.random().toString(36).substring(2) + '_' + Date.now().toString(36);
    localStorage.setItem(key, deviceId);
  }
  
  return deviceId;
};

/**
 * Lưu session vào localStorage
 */
export const saveSession = (session: Session): void => {
  localStorage.setItem('lms_session', JSON.stringify(session));
};

/**
 * Lấy session từ localStorage
 */
export const getSession = (): Session | null => {
  try {
    const stored = localStorage.getItem('lms_session');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

/**
 * Alias cho getSession (backward compatible)
 */
export const getStoredSession = getSession;

/**
 * Xóa session
 */
export const clearSession = (): void => {
  localStorage.removeItem('lms_session');
};

/**
 * Kiểm tra đã đăng nhập chưa
 */
export const isLoggedIn = (): boolean => {
  const session = getSession();
  return !!session?.sessionToken;
};

/**
 * Lấy user hiện tại
 */
export const getCurrentUser = (): User | null => {
  return getSession()?.user || null;
};

// ==================== AUTH API ====================

/**
 * Đăng nhập
 */
export const loginUser = async (email: string, password: string): Promise<Session | null> => {
  const deviceId = getDeviceId();
  
  const result = await callAPI<{ user: User; sessionToken: string }>('login', {
    email: email.trim().toLowerCase(),
    password,
    deviceId
  });
  
  if (result.status === 'success' && result.data) {
    const session: Session = {
      user: result.data.user,
      sessionToken: result.data.sessionToken,
      deviceId,
      loginTime: new Date().toISOString()
    };
    
    saveSession(session);
    return session;
  }
  
  return null;
};

/**
 * Validate session
 */
export const validateSession = async (): Promise<SessionValidation> => {
  const session = getSession();
  
  if (!session) {
    return { valid: false, reason: 'no_session' };
  }
  
  const result = await callAPI<SessionValidation>('validateSession', {
    email: session.user.email,
    sessionToken: session.sessionToken
  });
  
  if (result.status === 'success' && result.data) {
    return result.data;
  }
  
  return { valid: false, reason: 'invalid_token' };
};

/**
 * Heartbeat - duy trì session và phát hiện đăng nhập từ thiết bị khác
 */
export const sendHeartbeat = async (): Promise<SessionValidation> => {
  const session = getSession();
  
  if (!session) {
    return { valid: false, reason: 'no_session' };
  }
  
  const result = await callAPI<SessionValidation>('heartbeat', {
    email: session.user.email,
    sessionToken: session.sessionToken
  });
  
  if (result.status === 'success' && result.data) {
    return result.data;
  }
  
  // Network error - không invalidate session ngay
  if (result.message?.includes('fetch') || result.message?.includes('network')) {
    return { valid: true };
  }
  
  return { valid: false, reason: 'session_conflict' };
};

/**
 * Đăng xuất
 */
export const logoutUser = async (): Promise<boolean> => {
  const session = getSession();
  
  if (session) {
    await callAPI('logout', {
      email: session.user.email,
      sessionToken: session.sessionToken
    });
  }
  
  clearSession();
  return true;
};

// ==================== QUIZ API ====================

/**
 * Lấy danh sách topics theo khối lớp
 */
export const fetchTopics = async (grade: number = 12): Promise<string[]> => {
  const result = await callAPIWithRetry<string[]>('getTopics', { grade });
  
  if (result.status === 'success' && Array.isArray(result.data)) {
    return result.data;
  }
  
  return [];
};

/**
 * Lấy câu hỏi theo grade, topic, level
 */
export const fetchQuestions = async (
  grade: number, 
  topic: string, 
  level: number = 1
): Promise<Question[]> => {
  const result = await callAPIWithRetry<Question[]>('getQuestions', {
    grade,
    topic,
    level
  });
  
  if (result.status === 'success' && Array.isArray(result.data)) {
    return result.data;
  }
  
  return [];
};

/**
 * Lấy lý thuyết theo grade, topic, level
 */
export const fetchTheory = async (
  grade: number, 
  topic: string, 
  level: number
): Promise<Theory | null> => {
  const result = await callAPI<Theory>('getTheory', {
    grade,
    topic,
    level
  });
  
  if (result.status === 'success' && result.data) {
    return result.data;
  }
  
  return null;
};

/**
 * Lấy progress của user
 */
export const fetchUserProgress = async (email?: string): Promise<{
  totalScore: number;
  currentLevel: number;
  progress: Record<string, number>;
} | null> => {
  const session = getSession();
  const userEmail = email || session?.user?.email;
  
  if (!userEmail) {
    return null;
  }
  
  const result = await callAPI<{
    totalScore: number;
    currentLevel: number;
    progress: Record<string, number>;
  }>('getUserProgress', { email: userEmail });
  
  if (result.status === 'success' && result.data) {
    return result.data;
  }
  
  return null;
};

/**
 * Submit kết quả quiz - DÙNG GET ĐỂ TRÁNH CORS
 */
export const submitQuiz = async (
  quizData: {
    email: string;
    sessionToken: string;
    topic: string;
    grade: number;
    level: number;
    score: number;
    totalQuestions: number;
    answers: Array<{ questionId: string; userAnswer: string; correct: boolean }>;
    timeSpent: number;
    submissionReason: 'normal' | 'cheat_tab' | 'cheat_conflict';
    violations?: Array<{ type: string; timestamp: number }>;
  }
): Promise<QuizResult | null> => {
  try {
    // Encode data thành URL params để tránh CORS
    const params = new URLSearchParams({
      action: 'submitQuiz',
      payload: JSON.stringify(quizData)
    });
    
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });
    
    const json = await response.json();
    
    console.log('Submit quiz response:', json);
    
    if (json.status === 'success') {
      return json.data;
    }
    
    console.error('Submit quiz failed:', json.message);
    return null;
  } catch (error) {
    console.error('Submit quiz error:', error);
    return null;
  }
};

// ==================== VIOLATION API ====================

/**
 * Báo cáo vi phạm - DÙNG GET ĐỂ TRÁNH CORS
 */
export const reportViolation = async (
  email: string,
  type: string,
  details: Record<string, unknown>,
  quizInfo: { topic: string; level: number }
): Promise<boolean> => {
  try {
    const params = new URLSearchParams({
      action: 'reportViolation',
      payload: JSON.stringify({ email, type, details, quizInfo })
    });
    
    const url = `${GOOGLE_SCRIPT_URL}?${params.toString()}`;
    
    await fetch(url, {
      method: 'GET',
      redirect: 'follow'
    });
    
    return true;
  } catch (error) {
    console.error('Report violation error:', error);
    return false;
  }
};

// ==================== LEADERBOARD API ====================

/**
 * Lấy bảng xếp hạng
 */
export const fetchLeaderboard = async (limit: number = 20): Promise<LeaderboardEntry[]> => {
  const result = await callAPI<LeaderboardEntry[]>('getLeaderboard', { limit });
  
  if (result.status === 'success' && Array.isArray(result.data)) {
    return result.data;
  }
  
  return [];
};

// ==================== UTILITY FUNCTIONS ====================

/**
 * Test kết nối với server
 */
export const checkConnection = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const url = `${GOOGLE_SCRIPT_URL}?action=ping&t=${Date.now()}`;
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const json = await response.json();
    return json.status === 'success';
  } catch {
    return false;
  }
};

/**
 * Parse progress JSON string
 */
export const parseProgress = (progressStr: string | undefined): Record<string, number> => {
  if (!progressStr) return {};
  
  try {
    return JSON.parse(progressStr);
  } catch {
    return {};
  }
};

/**
 * Lấy level hiện tại cho một topic
 */
export const getCurrentLevel = (
  progress: Record<string, number>, 
  grade: number, 
  topic: string
): number => {
  const key = `${grade}_${topic}`;
  return progress[key] || 1;
};

/**
 * Kiểm tra level đã unlock chưa
 */
export const isLevelUnlocked = (
  progress: Record<string, number>,
  grade: number,
  topic: string,
  level: number
): boolean => {
  const currentLevel = getCurrentLevel(progress, grade, topic);
  return level <= currentLevel;
};

/**
 * Refresh user data từ server
 */
export const refreshUserData = async (): Promise<User | null> => {
  const session = getSession();
  
  if (!session) {
    return null;
  }
  
  const progressData = await fetchUserProgress(session.user.email);
  
  if (progressData) {
    const updatedUser: User = {
      ...session.user,
      totalScore: progressData.totalScore,
      currentLevel: progressData.currentLevel,
      progress: progressData.progress
    };
    
    saveSession({
      ...session,
      user: updatedUser
    });
    
    return updatedUser;
  }
  
  return session.user;
};

// ==================== DEBUG HELPERS ====================

/**
 * Test API call (dùng cho debug)
 */
export const testAPI = async (action: string, data: Record<string, unknown> = {}): Promise<unknown> => {
  console.log('Testing API:', action, data);
  const result = await callAPI(action, data);
  console.log('Result:', result);
  return result;
};

// Export URL để debug
export const getAPIUrl = () => GOOGLE_SCRIPT_URL;
