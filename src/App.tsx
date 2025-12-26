// ============================================================================
// LMS THẦY PHÚC - MAIN APP V2
// Tính năng: Level system, Anti-cheat, AI Tutor, Teacher Mode
// ============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ViewState, User, Question, QuizState, Theory, ChatMessage, TutorContext, QuizResult } from './types';
import {
  loginUser,
  logoutUser,
  fetchQuestions,
  fetchTopics,
  fetchTheory,
  fetchLeaderboard,
  fetchUserProgress,
  submitQuiz,
  sendHeartbeat,
  reportViolation,
  getSession,
  clearSession,
  GOOGLE_SCRIPT_URL
} from './services/sheetService';
import { askAITutor, incrementHintLevel, resetAllHints } from './services/geminiService';
import MathText from './components/MathText';
import { AdminPanel } from './components/AdminPanel';
import {
  BookOpen,
  Award,
  LogOut,
  User as UserIcon,
  Send,
  CheckCircle,
  XCircle,
  Trophy,
  BrainCircuit,
  Loader2,
  Lock,
  AlertTriangle,
  Monitor,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  RefreshCw,
  Star,
  Target,
  ArrowRight,
  ShieldAlert,
  BookMarked,
  Settings,
  RotateCcw,
  List,
  AlertCircle
} from 'lucide-react';

// ==================== MAIN APP ====================

const App: React.FC = () => {
  // Core state
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<ViewState>(ViewState.LOGIN);
  const [sessionToken, setSessionToken] = useState<string>('');
  
  // Quiz state
  const [selectedGrade, setSelectedGrade] = useState<number>(12);
  const [selectedTopic, setSelectedTopic] = useState<string>('');
  const [currentLevel, setCurrentLevel] = useState<number>(1);
  const [topics, setTopics] = useState<string[]>([]);
  const [quizState, setQuizState] = useState<QuizState>({
    questions: [],
    userAnswers: [],
    currentQuestionIndex: 0,
    isComplete: false,
    score: 0,
    startTime: 0,
    submissionReason: 'normal',
    tabSwitchCount: 0
  });
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [theory, setTheory] = useState<Theory | null>(null);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResultDetail, setShowResultDetail] = useState(false); // New state for showing details
  const timerRef = useRef<number | null>(null);
  
  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatThinking, setChatThinking] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // ==================== SESSION & ANTI-CHEAT ====================

  // Heartbeat
  useEffect(() => {
    if (!user || !sessionToken || view === ViewState.ADMIN_PANEL) return; // No heartbeat for admin
    
    const checkSession = async () => {
      const result = await sendHeartbeat();
      if (!result.valid) {
        if (result.reason === 'session_conflict') {
          if (view === ViewState.QUIZ && !quizState.isComplete) {
            handleFinishQuiz('cheat_conflict');
          } else {
            alert('⚠️ Tài khoản đã đăng nhập từ thiết bị khác!');
            handleLogout();
          }
        }
      }
    };
    
    const interval = setInterval(checkSession, 5000); 
    return () => clearInterval(interval);
  }, [user, sessionToken, view, quizState.isComplete]);

  // Tab Visibility (Anti-cheat)
  useEffect(() => {
    if (user?.role === 'teacher') return; // Skip for teachers

    const handleVisibility = () => {
      if (document.hidden && view === ViewState.QUIZ && !quizState.isComplete) {
        setQuizState(prev => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
        if (user) {
          reportViolation(user.email, 'tab_switch', {
          timestamp: Date.now(),
          count: quizState.tabSwitchCount + 1
        }, { topic: selectedTopic, level: currentLevel });
        }
        handleFinishQuiz('cheat_tab');
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [view, quizState.isComplete, user, selectedTopic, currentLevel]);

  // Quiz timer
  useEffect(() => {
    if (view === ViewState.QUIZ && !quizState.isComplete) {
      timerRef.current = window.setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) window.clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [view, quizState.isComplete]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // ==================== AUTH HANDLERS ====================

  const handleLogin = async (email: string, password: string) => {
    setLoading(true);
    setError('');
    
    const result = await loginUser(email, password);
    if (result) {
      setUser(result.user);
      setSessionToken(result.sessionToken);
      
      // Redirect based on role
      if (result.user.role === 'teacher' || result.user.role === 'admin') {
        setView(ViewState.ADMIN_PANEL);
      } else {
        setView(ViewState.DASHBOARD);
        const topicList = await fetchTopics(selectedGrade);
        setTopics(topicList);
      }
    } else {
      setError('Đăng nhập thất bại. Kiểm tra email/mật khẩu.');
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
    setSessionToken('');
    setView(ViewState.LOGIN);
    resetAllHints();
  };

  // ==================== QUIZ LOGIC FOR NEW TYPES ====================

  const handleSelectAnswer = (answer: string) => {
    if (quizState.isComplete) return;
    
    setQuizState(prev => {
      const newAnswers = [...prev.userAnswers];
      newAnswers[prev.currentQuestionIndex] = answer;
      return { ...prev, userAnswers: newAnswers };
    });
  };

  // Hàm xử lý đặc biệt cho Đúng/Sai (cập nhật từng phần a,b,c,d)
  const handleTrueFalseUpdate = (subPart: 'A'|'B'|'C'|'D', value: 'Đ'|'S') => {
    if (quizState.isComplete) return;

    setQuizState(prev => {
      const currentAns = prev.userAnswers[prev.currentQuestionIndex] || 'N-N-N-N'; // N = Null/Not selected
      const parts = currentAns.split('-');
      
      const idx = subPart === 'A' ? 0 : subPart === 'B' ? 1 : subPart === 'C' ? 2 : 3;
      parts[idx] = value;
      
      const newAnswers = [...prev.userAnswers];
      newAnswers[prev.currentQuestionIndex] = parts.join('-');
      return { ...prev, userAnswers: newAnswers };
    });
  };

  const handleFinishQuiz = useCallback(async (reason: 'normal' | 'cheat_tab' | 'cheat_conflict' = 'normal') => {
    if (quizState.isComplete) return;
    
    let correctCount = 0;
    const answers = quizState.questions.map((q, idx) => {
      const userAns = quizState.userAnswers[idx] || '';
      let isCorrect = false;

      // Logic chấm điểm theo loại câu hỏi
      if (q.question_type === 'Trắc nghiệm') {
        isCorrect = userAns === q.answer_key;
      } else if (q.question_type === 'Đúng/Sai') {
        // userAns: "Đ-S-Đ-S", answer_key: "Đ-S-S-S"
        // Phải đúng cả 4 ý mới tính điểm câu
        isCorrect = userAns === q.answer_key;
      } else if (q.question_type === 'Trả lời ngắn') {
         // So sánh string đã trim và lowercase
         isCorrect = userAns.trim().toLowerCase() === q.answer_key.trim().toLowerCase();
      }

      if (isCorrect) correctCount++;
      
      return {
        questionId: q.exam_id,
        userAnswer: userAns,
        correct: isCorrect
      };
    });
    
    setQuizState(prev => ({
      ...prev,
      isComplete: true,
      score: correctCount,
      endTime: Date.now(),
      submissionReason: reason
    }));
    
    if (user) {
      const result = await submitQuiz({
        email: user.email,
        sessionToken,
        topic: selectedTopic,
        grade: selectedGrade,
        level: currentLevel,
        score: correctCount,
        totalQuestions: quizState.questions.length,
        answers,
        timeSpent: elapsedTime,
        submissionReason: reason,
        violations: reason !== 'normal' ? [{ type: reason, timestamp: Date.now() }] : []
      });
      
      if (result) {
        setQuizResult(result);
        if (result.theory) setTheory(result.theory);
        if (result.canAdvance) {
             // update local logic
        }
      }
    }
    setView(ViewState.RESULT);
    setShowResultDetail(false);
  }, [quizState, user, sessionToken, selectedTopic, selectedGrade, currentLevel, elapsedTime]);

  // ... (Keep handleStartQuiz, handleNextQuestion, handlePrevQuestion, handleSelectGrade, handleSelectTopic similar to before) ...
  const handleSelectGrade = async (grade: number) => {
    setSelectedGrade(grade);
    setLoading(true);
    const topicList = await fetchTopics(grade);
    setTopics(topicList);
    setLoading(false);
  };

  const handleSelectTopic = (topic: string) => {
    setSelectedTopic(topic);
    const progressKey = `${selectedGrade}_${topic}`;
    const level = user?.progress?.[progressKey] || 1;
    setCurrentLevel(level);
    setView(ViewState.TOPIC_SELECT);
  };

  const handleStartQuiz = async (level: number) => {
    setLoading(true);
    setCurrentLevel(level);
    
    const questions = await fetchQuestions(selectedGrade, selectedTopic, level);
    
    if (questions.length === 0) {
      setError('Chưa có câu hỏi cho level này.');
      setLoading(false);
      return;
    }
    
    setQuizState({
      questions,
      userAnswers: new Array(questions.length).fill(null),
      currentQuestionIndex: 0,
      isComplete: false,
      score: 0,
      startTime: Date.now(),
      submissionReason: 'normal',
      tabSwitchCount: 0
    });
    setElapsedTime(0);
    resetAllHints();
    
    setChatMessages([{
      id: 'init',
      role: 'assistant',
      content: `Chào ${user?.name}! Thầy sẽ hỗ trợ em...`,
      timestamp: Date.now()
    }]);
    
    setView(ViewState.QUIZ);
    setLoading(false);
  };
  
  const handleNextQuestion = () => {
      if (quizState.currentQuestionIndex < quizState.questions.length - 1) {
          setQuizState(prev => ({...prev, currentQuestionIndex: prev.currentQuestionIndex + 1}));
      }
  };
  
  const handlePrevQuestion = () => {
      if (quizState.currentQuestionIndex > 0) {
          setQuizState(prev => ({...prev, currentQuestionIndex: prev.currentQuestionIndex - 1}));
      }
  };
  
  const handleSendChat = async () => {
      // (Keep existing chat logic)
      if (!chatInput.trim() || chatThinking) return;
      const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', content: chatInput, timestamp: Date.now() };
      setChatMessages(prev => [...prev, userMessage]);
      setChatInput('');
      setChatThinking(true);
      
      const currentQ = quizState.questions[quizState.currentQuestionIndex];
      const context: TutorContext = {
          questionId: currentQ?.exam_id,
          questionText: currentQ?.question_text,
          options: [currentQ.option_A, currentQ.option_B, currentQ.option_C, currentQ.option_D],
          userAnswer: quizState.userAnswers[quizState.currentQuestionIndex] || undefined,
          correctAnswer: currentQ?.answer_key,
          hintLevel: incrementHintLevel(currentQ?.exam_id || '')
      };
      
      const reply = await askAITutor(chatInput, context);
      const aiMessage: ChatMessage = { id: (Date.now()+1).toString(), role: 'assistant', content: reply.message, timestamp: Date.now() };
      setChatMessages(prev => [...prev, aiMessage]);
      setChatThinking(false);
  };


  // ==================== RENDERERS ====================

  const renderLogin = () => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-teal-100 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border-t-4 border-teal-500">
        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="text-teal-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 text-center">LMS Thầy Phúc</h1>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          handleLogin(formData.get('email') as string, formData.get('password') as string);
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" name="email" required className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="...@thayphuctoandongnai.edu.vn" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mật khẩu</label>
            <input type="password" name="password" required className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-teal-500 outline-none" placeholder="••••••••" />
          </div>
          
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2"><AlertTriangle size={16} />{error}</div>}
          
          <button type="submit" disabled={loading} className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded-lg transition-all flex justify-center items-center">
            {loading ? <Loader2 className="animate-spin" /> : 'Đăng Nhập'}
          </button>
        </form>
      </div>
    </div>
  );

  const renderQuizQuestion = () => {
      const currentQ = quizState.questions[quizState.currentQuestionIndex];
      const selectedAnswer = quizState.userAnswers[quizState.currentQuestionIndex];
      
      if (!currentQ) return null;

      // === RENDER TRẮC NGHIỆM ===
      if (currentQ.question_type === 'Trắc nghiệm') {
          return (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['A', 'B', 'C', 'D'].map(opt => {
              const optionKey = `option_${opt}` as keyof Question;
              const optionText = currentQ?.[optionKey] as string;
              const isSelected = selectedAnswer === opt;
              
              return (
                <button
                  key={opt}
                  onClick={() => handleSelectAnswer(opt)}
                  className={`p-4 rounded-xl border-2 text-left transition-all flex items-start gap-3 text-gray-900 ${
                    isSelected
                      ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500'
                      : 'border-gray-100 hover:border-teal-200 bg-white'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold ${
                    isSelected ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {opt}
                  </div>
                  <div className="flex-1 pt-2">
                    <MathText content={optionText || ''} />
                  </div>
                </button>
              );
            })}
          </div>
          );
      }
      
      // === RENDER ĐÚNG/SAI ===
      if (currentQ.question_type === 'Đúng/Sai') {
          const userParts = (selectedAnswer || 'N-N-N-N').split('-'); // N=None, Đ=True, S=False
          
          return (
              <div className="space-y-4">
                  {['A', 'B', 'C', 'D'].map((part, idx) => {
                      const optionKey = `option_${part}` as keyof Question;
                      const text = currentQ[optionKey] as string;
                      const choice = userParts[idx]; // 'Đ', 'S', or 'N'
                      
                      return (
                          <div key={part} className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col md:flex-row items-center gap-4">
                              <div className="font-bold text-teal-700 w-8">{part})</div>
                              <div className="flex-1 text-gray-900"><MathText content={text} /></div>
                              <div className="flex gap-2 shrink-0">
                                  <button
                                      onClick={() => handleTrueFalseUpdate(part as any, 'Đ')}
                                      className={`px-4 py-2 rounded-lg font-bold border transition-colors ${
                                          choice === 'Đ' ? 'bg-teal-500 text-white border-teal-600' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                                      }`}
                                  >
                                      Đúng
                                  </button>
                                  <button
                                      onClick={() => handleTrueFalseUpdate(part as any, 'S')}
                                      className={`px-4 py-2 rounded-lg font-bold border transition-colors ${
                                          choice === 'S' ? 'bg-orange-500 text-white border-orange-600' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                                      }`}
                                  >
                                      Sai
                                  </button>
                              </div>
                          </div>
                      );
                  })}
              </div>
          );
      }
      
      // === RENDER TRẢ LỜI NGẮN ===
      if (currentQ.question_type === 'Trả lời ngắn') {
          return (
              <div className="bg-white p-6 rounded-xl border border-gray-200">
                  <p className="mb-2 text-sm text-gray-500 font-semibold">Nhập đáp số của bạn:</p>
                  <input
                      type="text"
                      value={selectedAnswer || ''}
                      onChange={(e) => handleSelectAnswer(e.target.value)}
                      placeholder="Ví dụ: 15.5"
                      className="w-full p-4 text-lg border-2 border-gray-300 rounded-xl focus:border-teal-500 focus:ring-2 focus:ring-teal-200 outline-none font-mono text-gray-900"
                  />
              </div>
          );
      }

      return <div>Loại câu hỏi không hỗ trợ</div>;
  };

  const renderQuiz = () => (
      <div className="max-w-4xl mx-auto p-4">
        {/* Header Quiz info */}
        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex justify-between items-center sticky top-4 z-10 border-l-4 border-teal-500">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase">Thời gian</span>
              <p className="text-xl font-mono text-teal-700 font-bold">
                {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div>
              <span className="text-xs font-bold text-gray-400 uppercase">Level</span>
              <p className="text-lg font-bold text-gray-700">{currentLevel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-teal-600">Câu {quizState.currentQuestionIndex + 1}</span>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-400">{quizState.questions.length}</span>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full h-2 bg-gray-200 rounded-full mb-6 overflow-hidden">
          <div className="h-full bg-teal-500 transition-all duration-500" style={{ width: `${((quizState.currentQuestionIndex + 1) / quizState.questions.length) * 100}%` }} />
        </div>

        {/* Question Text */}
        <div className="bg-white p-6 md:p-10 rounded-2xl shadow-lg mb-6">
          <div className="mb-6 pb-6 border-b border-gray-100">
             <div className="flex justify-between items-center mb-2">
                <span className="bg-teal-600 text-white text-xs font-black px-3 py-1 rounded mr-3">
                  CÂU {quizState.currentQuestionIndex + 1}
                </span>
                <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded">
                   {quizState.questions[quizState.currentQuestionIndex]?.question_type}
                </span>
             </div>
             
            <div className="mt-4 text-xl font-medium text-gray-800 leading-relaxed">
              <MathText content={quizState.questions[quizState.currentQuestionIndex]?.question_text || ''} />
            </div>
          </div>
          
          {/* Dynamic Question Body */}
          {renderQuizQuestion()}
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center">
            <button onClick={handlePrevQuestion} disabled={quizState.currentQuestionIndex === 0} className="flex items-center px-6 py-3 rounded-xl font-bold text-gray-400 bg-white shadow hover:text-teal-600 disabled:opacity-30 transition-all">
                <ChevronLeft size={20} className="mr-1" /> Quay lại
            </button>
            <button onClick={() => setChatOpen(true)} className="px-4 py-2 rounded-xl bg-teal-100 text-teal-700 font-medium hover:bg-teal-200 transition-all flex items-center gap-2">
                <Lightbulb size={18} /> Gợi ý
            </button>
            {quizState.currentQuestionIndex === quizState.questions.length - 1 ? (
                <button onClick={() => handleFinishQuiz('normal')} className="px-10 py-4 rounded-xl font-black text-white bg-teal-600 shadow-xl hover:bg-teal-700 transition-all uppercase tracking-wide">
                    Nộp bài
                </button>
            ) : (
                <button onClick={handleNextQuestion} className="flex items-center px-8 py-3 rounded-xl font-bold text-white bg-teal-600 shadow hover:bg-teal-700 transition-all">
                    Tiếp theo <ChevronRight size={20} className="ml-1" />
                </button>
            )}
        </div>
        
        {/* Chat */}
        {renderChatWidget()}
      </div>
  );

  const renderAdminPanel = () => (
      <AdminPanel onLogout={handleLogout} />
  );

  const renderTheoryReview = () => (
    <div className="max-w-4xl mx-auto p-6">
      <button onClick={() => setView(ViewState.RESULT)} className="mb-6 flex items-center gap-2 text-gray-500 hover:text-teal-600 font-medium">
        <ChevronLeft size={20} /> Quay lại kết quả
      </button>
      
      {theory ? (
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-200">
          <div className="bg-teal-600 p-6 text-white">
            <h2 className="text-2xl font-bold mb-1">Ôn tập kiến thức</h2>
            <p className="opacity-90">{selectedTopic} - Level {currentLevel}</p>
          </div>
          
          <div className="p-8 theory-content">
            <h1 className="text-3xl font-bold text-teal-800 mb-6 border-b pb-4">{theory.title}</h1>
            
            <div className="prose prose-lg text-gray-700 max-w-none">
              <MathText content={theory.content} block />
            </div>

            {theory.examples && (
              <div className="mt-8 bg-blue-50 p-6 rounded-xl border border-blue-100">
                <h3 className="font-bold text-blue-800 text-lg mb-3 flex items-center gap-2">
                  <BookMarked size={20} /> Ví dụ minh họa
                </h3>
                <div className="text-gray-700">
                  <MathText content={theory.examples} block />
                </div>
              </div>
            )}

            {theory.tips && (
              <div className="mt-6 bg-yellow-50 p-6 rounded-xl border border-yellow-100">
                <h3 className="font-bold text-yellow-800 text-lg mb-3 flex items-center gap-2">
                  <Lightbulb size={20} /> Mẹo ghi nhớ
                </h3>
                <div className="text-gray-700 italic">
                  <MathText content={theory.tips} />
                </div>
              </div>
            )}
          </div>
          
          <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end gap-4">
             <button 
               onClick={() => handleStartQuiz(currentLevel)}
               className="px-6 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 flex items-center gap-2"
             >
               <RotateCcw size={18} /> Làm lại bài thi
             </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-20 bg-white rounded-2xl shadow">
          <p className="text-gray-500">Chưa có dữ liệu lý thuyết cho phần này.</p>
        </div>
      )}
    </div>
  );

  const renderResult = () => (
    <div className="max-w-4xl mx-auto p-6">
       {/* Violation Alert */}
       {quizResult?.submissionReason !== 'normal' && (
           <div className="mb-6 bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded shadow-md flex items-start gap-3">
               <AlertCircle className="shrink-0 mt-0.5" />
               <div>
                   <p className="font-bold">Cảnh báo vi phạm quy chế thi!</p>
                   <p className="text-sm">
                       {quizResult?.submissionReason === 'cheat_tab' 
                           ? 'Hệ thống phát hiện bạn đã chuyển tab hoặc rời khỏi màn hình làm bài.' 
                           : 'Tài khoản của bạn đã đăng nhập ở một thiết bị khác trong lúc làm bài.'}
                   </p>
               </div>
           </div>
       )}

       <div className="bg-white rounded-3xl shadow-xl p-12 text-center mb-6">
           <h2 className="text-3xl font-bold mb-4">{quizResult?.passed ? '🎉 Xuất sắc!' : '📚 Cố gắng lên!'}</h2>
           <p className="text-gray-500 mb-6">{quizResult?.message}</p>
           <div className={`text-6xl font-black mb-8 ${quizResult?.passed ? 'text-teal-600' : 'text-orange-500'}`}>{quizResult?.percentage}%</div>
           
           <div className="flex justify-center gap-4 flex-wrap">
              <button onClick={() => setView(ViewState.DASHBOARD)} className="px-6 py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-all">Về trang chủ</button>
              
              <button 
                  onClick={() => setShowResultDetail(!showResultDetail)} 
                  className="px-6 py-3 bg-blue-100 text-blue-700 rounded-xl font-bold hover:bg-blue-200 flex items-center gap-2"
              >
                  <List size={20} /> {showResultDetail ? 'Ẩn chi tiết' : 'Xem chi tiết bài làm'}
              </button>

              {!quizResult?.passed && (
                  <button 
                      onClick={() => setView(ViewState.THEORY_REVIEW)} 
                      className="px-6 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-lg flex items-center gap-2"
                  >
                      <BookOpen size={20} /> Ôn tập kiến thức
                  </button>
              )}
              
              {quizResult?.passed && (
                  <button 
                      onClick={() => {
                          if (currentLevel < 5) handleStartQuiz(currentLevel + 1);
                          else setView(ViewState.DASHBOARD);
                      }}
                      className="px-6 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 shadow-lg"
                  >
                      Tiếp tục
                  </button>
              )}
           </div>
       </div>

       {/* Detail Review Section */}
       {showResultDetail && (
           <div className="space-y-6 animate-fade-in">
               <h3 className="text-xl font-bold text-gray-700 px-2">Chi tiết câu hỏi</h3>
               {quizState.questions.map((q, idx) => {
                   // Calculate correctness
                   const userAns = quizState.userAnswers[idx] || '';
                   let isCorrect = false;
                   if (q.question_type === 'Trắc nghiệm') isCorrect = userAns === q.answer_key;
                   else if (q.question_type === 'Đúng/Sai') isCorrect = userAns === q.answer_key;
                   else isCorrect = userAns.trim().toLowerCase() === q.answer_key.trim().toLowerCase();

                   return (
                       <div key={idx} className={`bg-white p-6 rounded-xl border-l-4 shadow-sm ${isCorrect ? 'border-green-500' : 'border-red-500'}`}>
                           <div className="flex justify-between mb-2">
                               <span className="font-bold text-gray-500">Câu {idx + 1} ({q.question_type})</span>
                               <span className={`font-bold px-2 py-1 rounded text-xs ${isCorrect ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                   {isCorrect ? 'Đúng' : 'Sai'}
                               </span>
                           </div>
                           <div className="mb-4 text-gray-800">
                               <MathText content={q.question_text} />
                           </div>
                           
                           {/* XỬ LÝ HIỂN THỊ KẾT QUẢ CHO CÂU HỎI ĐÚNG/SAI */}
                           {q.question_type === 'Đúng/Sai' ? (
                               <div className="mb-4 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                                   <div className="grid grid-cols-12 gap-2 p-2 bg-gray-100 font-bold text-xs text-gray-600 uppercase">
                                       <div className="col-span-1 text-center">Ý</div>
                                       <div className="col-span-8">Mệnh đề</div>
                                       <div className="col-span-3 text-center">Kết quả</div>
                                   </div>
                                   {['A', 'B', 'C', 'D'].map((opt, optIdx) => {
                                       const userChoices = (userAns || 'N-N-N-N').split('-');
                                       const correctKeys = (q.answer_key || 'S-S-S-S').split('-');
                                       
                                       const userChoice = userChoices[optIdx];
                                       const correctKey = correctKeys[optIdx];
                                       const isOptCorrect = userChoice === correctKey;

                                       return (
                                           <div key={opt} className="grid grid-cols-12 gap-2 p-3 border-t border-gray-200 items-center text-sm">
                                               <div className="col-span-1 font-bold text-center text-teal-700">{opt})</div>
                                               <div className="col-span-8"><MathText content={(q as any)[`option_${opt}`]} /></div>
                                               <div className="col-span-3 text-center flex flex-col items-center">
                                                   <span className={`font-bold ${isOptCorrect ? 'text-green-600' : 'text-red-500'}`}>
                                                       {userChoice === 'Đ' ? 'Đúng' : userChoice === 'S' ? 'Sai' : '-'}
                                                   </span>
                                                   {!isOptCorrect && (
                                                       <span className="text-xs text-gray-400">Đáp án: {correctKey === 'Đ' ? 'Đúng' : 'Sai'}</span>
                                                   )}
                                               </div>
                                           </div>
                                       );
                                   })}
                               </div>
                           ) : (
                               // HIỂN THỊ CHO TRẮC NGHIỆM VÀ TRẢ LỜI NGẮN
                               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                   <div className="p-3 bg-gray-50 rounded border">
                                       <span className="font-bold block text-gray-500 mb-1">Câu trả lời của bạn:</span>
                                       <span className={isCorrect ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>
                                           {userAns || '(Chưa trả lời)'}
                                       </span>
                                   </div>
                                   {!isCorrect && (
                                       <div className="p-3 bg-green-50 rounded border border-green-200">
                                           <span className="font-bold block text-green-700 mb-1">Đáp án đúng:</span>
                                           <span className="text-green-800 font-bold">{q.answer_key}</span>
                                       </div>
                                   )}
                               </div>
                           )}
                           
                           {/* Show full options context for Multiple Choice if wrong */}
                           {!isCorrect && q.question_type === 'Trắc nghiệm' && (
                               <div className="mt-3 text-sm text-gray-500">
                                   <p>A. <MathText content={q.option_A}/></p>
                                   <p>B. <MathText content={q.option_B}/></p>
                                   <p>C. <MathText content={q.option_C}/></p>
                                   <p>D. <MathText content={q.option_D}/></p>
                               </div>
                           )}
                           
                           <div className="mt-4 pt-3 border-t border-gray-100">
                               <p className="text-sm font-bold text-gray-500 mb-1">Lời giải chi tiết:</p>
                               <div className="text-gray-700 bg-yellow-50 p-3 rounded"><MathText content={q.solution} /></div>
                           </div>
                       </div>
                   );
               })}
           </div>
       )}
    </div>
  );

  const renderChatWidget = () => {
    if (!chatOpen) return null;
    return (
      <div className="fixed bottom-6 right-6 w-96 max-w-[90vw] h-[500px] bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-teal-200 overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 to-teal-700 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <BrainCircuit size={20} />
            <span className="font-bold">Trợ Lý Thầy Phúc (AI)</span>
          </div>
          <button onClick={() => setChatOpen(false)} className="hover:bg-white/20 p-1 rounded">
            <XCircle size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-gray-50" ref={chatScrollRef}>
          {chatMessages.map((msg, idx) => (
            <div key={idx} className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-3 rounded-lg text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-teal-600 text-white rounded-br-none'
                  : 'bg-white text-gray-700 shadow-sm border border-gray-200 rounded-bl-none'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {chatThinking && <div className="text-gray-400 text-xs p-2">Đang suy nghĩ...</div>}
        </div>
        <div className="p-3 bg-white border-t border-gray-100 flex gap-2">
          <input
            type="text"
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-teal-500"
            placeholder="Em cần gợi ý gì..."
            value={chatInput}
            onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button onClick={handleSendChat} disabled={chatThinking} className="bg-teal-600 text-white p-2 rounded-full hover:bg-teal-700 disabled:opacity-50">
            <Send size={18} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {view === ViewState.LOGIN && renderLogin()}
      {view === ViewState.ADMIN_PANEL && renderAdminPanel()} 
      
      {view !== ViewState.LOGIN && view !== ViewState.ADMIN_PANEL && (
        <>
          <nav className="bg-white border-b border-gray-100 px-6 py-4 flex justify-between items-center sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-2 font-bold text-xl text-teal-700 cursor-pointer" onClick={() => setView(ViewState.DASHBOARD)}>
              <BookOpen className="text-teal-500" /> <span className="hidden md:inline">LMS Thầy Phúc</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600 hidden md:inline">Xin chào, <b>{user?.name}</b></span>
              {user?.role === 'teacher' && (
                  <button onClick={() => setView(ViewState.ADMIN_PANEL)} className="text-teal-600 hover:text-teal-800" title="Trang quản trị"><Settings size={20}/></button>
              )}
              <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Đăng xuất"><LogOut size={20} /></button>
            </div>
          </nav>

          <main className="pb-20">
            {/* ... Render appropriate views based on ViewState ... */}
            {view === ViewState.DASHBOARD && (
                <div className="max-w-5xl mx-auto p-6">
                    {/* (Dashboard content similar to previous version) */}
                     <div className="bg-gradient-to-r from-teal-500 to-teal-700 rounded-2xl p-6 text-white shadow-lg mb-8">
                        <div className="flex justify-between items-start">
                          <div>
                            <h2 className="text-3xl font-bold mb-2">Xin chào, {user?.name}</h2>
                            <p className="opacity-90">Lớp {user?.class} | Điểm tích lũy: {user?.totalScore || 0}</p>
                          </div>
                          <button onClick={() => setView(ViewState.LEADERBOARD)} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg flex items-center gap-2"><Trophy size={18} /> Bảng Vàng</button>
                        </div>
                      </div>
                      
                      <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><Target className="text-teal-600" /> Chọn khối lớp</h3>
                      <div className="flex gap-4 mb-6">
                        {[10, 11, 12].map(grade => (
                          <button key={grade} onClick={() => handleSelectGrade(grade)} className={`px-8 py-3 rounded-xl font-bold transition-all ${selectedGrade === grade ? 'bg-teal-600 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}>Lớp {grade}</button>
                        ))}
                      </div>

                      <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2"><BookOpen className="text-teal-600" /> Chọn chủ đề</h3>
                      {loading ? <Loader2 className="animate-spin text-teal-600 mx-auto" size={40} /> : (
                         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                           {topics.map(topic => (
                               <button key={topic} onClick={() => handleSelectTopic(topic)} className="bg-white p-6 rounded-xl border border-gray-200 hover:border-teal-400 hover:shadow-lg transition-all text-left">
                                   <div className="font-bold text-lg text-gray-800 mb-1">{topic}</div>
                                   <div className="text-sm text-gray-500">Lớp {selectedGrade}</div>
                               </button>
                           ))}
                         </div>
                      )}
                </div>
            )}
            
            {view === ViewState.TOPIC_SELECT && (
                <div className="max-w-3xl mx-auto p-6">
                    <button onClick={() => setView(ViewState.DASHBOARD)} className="mb-6 text-gray-500 hover:text-teal-600 font-medium flex items-center gap-2"><ChevronLeft size={20} /> Quay lại</button>
                    <div className="bg-white rounded-2xl shadow-lg p-8">
                         <h2 className="text-2xl font-bold text-gray-800 text-center mb-6">{selectedTopic}</h2>
                         <div className="space-y-3">
                            {[1,2,3,4,5].map(lvl => (
                                <button key={lvl} onClick={() => lvl <= currentLevel && handleStartQuiz(lvl)} disabled={lvl > currentLevel} className={`w-full p-4 rounded-xl border-2 flex justify-between items-center ${lvl <= currentLevel ? 'border-teal-500 bg-teal-50' : 'border-gray-200 opacity-60'}`}>
                                    <span className="font-bold text-gray-800">Level {lvl}</span>
                                    {lvl <= currentLevel ? <CheckCircle className="text-teal-500"/> : <Lock size={16}/>}
                                </button>
                            ))}
                         </div>
                    </div>
                </div>
            )}

            {view === ViewState.QUIZ && renderQuiz()}
            
            {view === ViewState.RESULT && renderResult()}
            
            {view === ViewState.THEORY_REVIEW && renderTheoryReview()}
            
            {view === ViewState.LEADERBOARD && (
                 <div className="max-w-4xl mx-auto p-6">
                    <button onClick={() => setView(ViewState.DASHBOARD)} className="mb-6 flex gap-2 text-gray-500"><ChevronLeft /> Quay lại</button>
                    <div className="bg-white rounded-2xl shadow-lg p-8">
                        <h2 className="text-2xl font-bold mb-6 text-center text-teal-700">Bảng Vàng</h2>
                        <div className="text-center text-gray-500">Đang tải bảng xếp hạng...</div>
                    </div>
                 </div>
            )}
          </main>

          {/* Chat Button */}
          {view !== ViewState.QUIZ && (
            <button onClick={() => setChatOpen(true)} className="fixed bottom-6 right-6 bg-gradient-to-r from-teal-500 to-teal-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all z-50 flex items-center gap-2">
              <BrainCircuit size={24} /> <span className="font-semibold hidden md:inline">Hỏi Trợ Lý AI</span>
            </button>
          )}

          {chatOpen && view !== ViewState.QUIZ && renderChatWidget()}
        </>
      )}
    </div>
  );
};

export default App;