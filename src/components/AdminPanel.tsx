import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, Trash2, Edit, Plus, CheckCircle, XCircle, Download, Settings, Users, BrainCircuit, Save, RefreshCw, Loader2, BookOpen, PenTool, ChevronDown, ChevronUp, AlertTriangle, ScanLine, FileUp, ArrowRight, Library, Database, Eye, UploadCloud, Sparkles, Wand2, Image as ImageIcon, FileDown, CheckCircle2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { GOOGLE_SCRIPT_URL, uploadPDFToGAS } from '../services/sheetService';
import { generateQuestionFromAI, generateTheoryFromAI, performOCR, correctTextStream, parseQuestionsFromMarkdown } from '../services/geminiService';
import MathText from './MathText';
import Button from './Button';
import { DocumentResource, Question, AppState, OCRResult } from '../types';

interface AdminProps {
  onLogout: () => void;
}

const GRADES = [6, 7, 8, 9, 10, 11, 12];

export const AdminPanel: React.FC<AdminProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<'students' | 'questions' | 'ai-gen' | 'pdf-upload'>('questions');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null);

  // Data states
  const [questions, setQuestions] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [studentResults, setStudentResults] = useState<any[]>([]);
  const [documents, setDocuments] = useState<DocumentResource[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null);
  const [expandedResultId, setExpandedResultId] = useState<string | null>(null);

  // Edit State
  const [editingQuestion, setEditingQuestion] = useState<Partial<Question> | null>(null);

  // AI Gen states
  const [genMode, setGenMode] = useState<'question' | 'theory'>('question');
  
  // Nguồn dữ liệu: 'manual' (tự nhập chủ đề), 'select-file' (chọn từ kho)
  const [inputMode, setInputMode] = useState<'manual' | 'select-file'>('manual');
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  
  // OCR / Resource Upload states
  const [ocrFile, setOcrFile] = useState<{name: string, data: string, type: string} | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showResourceLibrary, setShowResourceLibrary] = useState(false); // Toggle view
  
  const [aiConfig, setAiConfig] = useState({ grade: 12, topic: 'Hàm số', level: 'Thông hiểu', numericLevel: 1, type: 'Trắc nghiệm' });
  
  const [generatedQuestion, setGeneratedQuestion] = useState<any>(null);
  const [generatedTheory, setGeneratedTheory] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  
  // PDF UPLOAD & EXAM CREATE STATES
  const [pdfState, setPdfState] = useState<AppState>(AppState.IDLE);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfOcrResult, setPdfOcrResult] = useState<OCRResult | null>(null);
  const [correctedPdfText, setCorrectedPdfText] = useState<string>('');
  const [extractedQuestions, setExtractedQuestions] = useState<Partial<Question>[]>([]);
  const [pdfConfig, setPdfConfig] = useState({ grade: 12, topic: 'Đề ôn tập' });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'questions') loadQuestions();
    if (activeTab === 'students') loadStudents();
    if (activeTab === 'ai-gen') loadDocuments();
  }, [activeTab]);

  const ensureQuestionsLoaded = async () => {
      if (questions.length === 0) {
          await loadQuestions();
      }
  };

  const loadQuestions = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getAllQuestions`);
      const data = await res.json();
      if (data.status === 'success') setQuestions(data.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadStudents = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getAllStudents`);
      const data = await res.json();
      if (data.status === 'success') setStudents(data.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const loadDocuments = async () => {
    try {
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getAllDocuments`);
      const data = await res.json();
      if (data.status === 'success') setDocuments(data.data);
    } catch (e) { console.error(e); }
  };

  const loadStudentResults = async (email: string) => {
    setSelectedStudent(email);
    setLoading(true);
    setExpandedResultId(null);
    try {
      await ensureQuestionsLoaded();
      const res = await fetch(`${GOOGLE_SCRIPT_URL}?action=getStudentResults&payload=${JSON.stringify({email})}`);
      const data = await res.json();
      if (data.status === 'success') setStudentResults(data.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              const base64 = ev.target?.result as string;
              const base64Data = base64.split(',')[1];
              setOcrFile({
                  name: file.name,
                  data: base64Data,
                  type: file.type
              });
          };
          reader.readAsDataURL(file);
      }
  };
  
  const handlePerformOCR = async () => {
      if (!ocrFile) return;
      setOcrLoading(true);
      const text = await performOCR(ocrFile.data, ocrFile.type);
      if (text) {
          setOcrText(text);
          setMessage({ type: 'success', text: 'Đọc file thành công! Hãy kiểm tra và lưu lại.' });
      } else {
          setMessage({ type: 'error', text: 'Không thể đọc file. Vui lòng thử lại.' });
      }
      setOcrLoading(false);
  };

  const handleSaveDocument = async () => {
     if (!ocrFile || !ocrText) return;
     setOcrLoading(true);
     try {
         const res = await fetch(GOOGLE_SCRIPT_URL, {
             method: 'POST',
             body: JSON.stringify({
                 action: 'saveDocument',
                 name: ocrFile.name,
                 content: ocrText
             })
         });
         const data = await res.json();
         if (data.status === 'success') {
             setMessage({ type: 'success', text: 'Đã lưu tài liệu vào kho!' });
             setOcrFile(null);
             setOcrText('');
             loadDocuments(); // Refresh list
             setShowResourceLibrary(false); // Back to generator
         } else {
             setMessage({ type: 'error', text: 'Lỗi khi lưu tài liệu' });
         }
     } catch (e) { setMessage({ type: 'error', text: 'Lỗi kết nối' }); }
     setOcrLoading(false);
  };

  const handleDeleteDocument = async (id: string) => {
      if (!confirm('Xóa tài liệu này khỏi kho?')) return;
      await fetch(`${GOOGLE_SCRIPT_URL}?action=deleteDocument&payload=${JSON.stringify({id})}`);
      loadDocuments();
  };

  const handleGenerateAI = async () => {
    setGenerating(true);
    setGeneratedQuestion(null);
    setGeneratedTheory(null);
    
    if (genMode === 'question') {
      let sourceText = undefined;
      
      // Nếu chọn file từ kho
      if (inputMode === 'select-file' && selectedDocId) {
          const doc = documents.find(d => d.id === selectedDocId);
          if (doc) sourceText = doc.content;
      }
      
      const result = await generateQuestionFromAI(
        Number(aiConfig.grade), aiConfig.topic, aiConfig.level, aiConfig.type as any, sourceText
      );
      if (result) setGeneratedQuestion(result);
    } else {
      const result = await generateTheoryFromAI(
        Number(aiConfig.grade), aiConfig.topic, aiConfig.numericLevel
      );
      if (result) setGeneratedTheory(result);
    }
    
    setGenerating(false);
  };

  const handleSaveGenerated = async () => {
    setLoading(true);
    try {
      let body: any = {};
      
      if (genMode === 'question' && generatedQuestion) {
        body = {
          action: 'saveQuestion',
          exam_id: `Q${Date.now()}`,
          grade: aiConfig.grade,
          topic: aiConfig.topic,
          level: aiConfig.level,
          quiz_level: aiConfig.numericLevel,
          question_type: aiConfig.type,
          ...generatedQuestion
        };
      } else if (genMode === 'theory' && generatedTheory) {
        body = {
          action: 'saveTheory',
          ...generatedTheory,
          grade: aiConfig.grade,
          topic: aiConfig.topic,
          level: aiConfig.numericLevel
        };
      } else {
        setLoading(false);
        return;
      }

      const res = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      
      if (data.status === 'success') {
        setMessage({ type: 'success', text: `Đã lưu thành công!` });
        setGeneratedQuestion(null);
        setGeneratedTheory(null);
      } else {
        setMessage({ type: 'error', text: 'Lỗi khi lưu: ' + data.message });
      }
    } catch (e) { setMessage({ type: 'error', text: 'Lỗi kết nối' }); }
    setLoading(false);
  };

  const handleSaveEdit = async () => {
    if (!editingQuestion) return;
    setLoading(true);
    try {
      const body = {
        action: 'saveQuestion',
        ...editingQuestion
      };
      
      const res = await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      
      if (data.status === 'success') {
        setMessage({ type: 'success', text: 'Đã cập nhật câu hỏi thành công!' });
        setEditingQuestion(null);
        loadQuestions(); // Reload list
      } else {
        setMessage({ type: 'error', text: 'Lỗi khi cập nhật: ' + data.message });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Lỗi kết nối khi cập nhật' });
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if(!confirm('Xóa câu hỏi này?')) return;
    await fetch(`${GOOGLE_SCRIPT_URL}?action=deleteQuestion&payload=${JSON.stringify({exam_id: id})}`);
    loadQuestions();
  };

  const toggleExpandResult = (id: string) => {
      setExpandedResultId(expandedResultId === id ? null : id);
  };

  const getQuestionDetails = (questionId: string) => {
      return questions.find(q => q.exam_id === questionId);
  };
  
  const handleEditFieldChange = (field: keyof Question, value: any) => {
      setEditingQuestion(prev => prev ? ({ ...prev, [field]: value }) : null);
  };

  // Helper cho câu hỏi Đúng/Sai (cập nhật chuỗi Đ-S-Đ-S)
  const updateTrueFalseKey = (target: 'generated' | 'editing', index: number, value: 'Đ' | 'S') => {
      if (target === 'generated' && generatedQuestion) {
          const currentKeys = (generatedQuestion.answer_key || "S-S-S-S").split('-');
          currentKeys[index] = value;
          setGeneratedQuestion({ ...generatedQuestion, answer_key: currentKeys.join('-') });
      } else if (target === 'editing' && editingQuestion) {
          const currentKeys = (editingQuestion.answer_key || "S-S-S-S").split('-');
          currentKeys[index] = value;
          setEditingQuestion({ ...editingQuestion, answer_key: currentKeys.join('-') });
      }
  };

  // ================= PDF UPLOAD HANDLERS =================
  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          setPdfFile(e.target.files[0]);
          setPdfState(AppState.IDLE);
          setPdfOcrResult(null);
          setCorrectedPdfText('');
          setExtractedQuestions([]);
      }
  };

  const handlePdfUpload = async () => {
      if (!pdfFile) return;
      setPdfState(AppState.UPLOADING_OCR);
      try {
          const result = await uploadPDFToGAS(pdfFile);
          setPdfOcrResult(result);
          setPdfState(AppState.OCR_COMPLETE);
      } catch (e: any) {
          setMessage({type: 'error', text: 'Lỗi upload PDF: ' + e.message});
          setPdfState(AppState.ERROR);
      }
  };

  const handlePdfCorrection = async () => {
      if (!pdfOcrResult?.allMarkdownDataUri) return;
      setPdfState(AppState.CORRECTING);
      try {
          // Streaming text correction
          let text = '';
          await correctTextStream(pdfOcrResult.allMarkdownDataUri, (chunk) => {
              text += chunk;
              setCorrectedPdfText(prev => prev + chunk); // For visual feedback if needed
          });
          // Final text set (though streaming already set it)
          setCorrectedPdfText(text);
          setPdfState(AppState.OCR_COMPLETE);
      } catch (e) {
           setMessage({type: 'error', text: 'Lỗi sửa lỗi AI'});
           setPdfState(AppState.ERROR);
      }
  };

  const handleExtractQuestions = async () => {
      if (!correctedPdfText) return;
      setGenerating(true);
      try {
          const qs = await parseQuestionsFromMarkdown(correctedPdfText, pdfConfig.grade, pdfConfig.topic);
          setExtractedQuestions(qs);
          setMessage({type: 'success', text: `Đã trích xuất ${qs.length} câu hỏi!`});
      } catch (e) {
          setMessage({type: 'error', text: 'Lỗi trích xuất câu hỏi'});
      }
      setGenerating(false);
  };

  const handleSaveAllExtracted = async () => {
      if (extractedQuestions.length === 0) return;
      setLoading(true);
      let successCount = 0;
      
      for (const q of extractedQuestions) {
          try {
              const body = {
                  action: 'saveQuestion',
                  exam_id: `Q${Date.now()}_${Math.floor(Math.random()*1000)}`,
                  grade: q.grade,
                  topic: q.topic,
                  level: q.level,
                  quiz_level: 1,
                  question_type: q.question_type,
                  question_text: q.question_text,
                  option_A: q.option_A,
                  option_B: q.option_B,
                  option_C: q.option_C,
                  option_D: q.option_D,
                  answer_key: q.answer_key,
                  solution: q.solution,
                  image_id: q.image_id
              };
               await fetch(GOOGLE_SCRIPT_URL, { method: 'POST', body: JSON.stringify(body) });
               successCount++;
          } catch(e) { console.error(e); }
      }
      
      setMessage({type: 'success', text: `Đã lưu ${successCount}/${extractedQuestions.length} câu hỏi vào kho!`});
      setLoading(false);
      setExtractedQuestions([]); // Clear after save
      loadQuestions(); // Refresh list
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <Settings className="text-teal-600" size={28} />
          <h1 className="text-2xl font-bold text-slate-800">Admin Panel <span className="text-sm font-normal text-slate-500">| LMS Thầy Phúc</span></h1>
        </div>
        <button onClick={onLogout} className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition">Đăng xuất</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-slate-200 p-4 space-y-2 shrink-0 overflow-y-auto">
          <button 
            onClick={() => setActiveTab('questions')}
            className={`w-full text-left px-4 py-3 rounded-xl font-medium flex items-center gap-3 transition ${activeTab === 'questions' ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <FileText size={20} /> Quản lý Câu hỏi
          </button>
          <button 
            onClick={() => setActiveTab('pdf-upload')}
            className={`w-full text-left px-4 py-3 rounded-xl font-medium flex items-center gap-3 transition ${activeTab === 'pdf-upload' ? 'bg-orange-50 text-orange-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <FileUp size={20} /> Tạo đề từ PDF (OCR)
          </button>
          <button 
            onClick={() => setActiveTab('students')}
            className={`w-full text-left px-4 py-3 rounded-xl font-medium flex items-center gap-3 transition ${activeTab === 'students' ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <Users size={20} /> Quản lý Học sinh
          </button>
          <button 
            onClick={() => setActiveTab('ai-gen')}
            className={`w-full text-left px-4 py-3 rounded-xl font-medium flex items-center gap-3 transition ${activeTab === 'ai-gen' ? 'bg-purple-50 text-purple-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <BrainCircuit size={20} /> AI Generator (Topic)
          </button>
        </aside>

        {/* Content */}
        <main className="flex-1 p-8 overflow-y-auto">
          {message && (
            <div className={`mb-6 p-4 rounded-lg flex justify-between items-center ${message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              <span>{message.text}</span>
              <button onClick={() => setMessage(null)}><XCircle size={18}/></button>
            </div>
          )}

          {/* QUESTIONS TAB */}
          {activeTab === 'questions' && (
            <div>
              <div className="flex justify-between mb-6">
                <h2 className="text-2xl font-bold text-slate-800">Danh sách câu hỏi ({questions.length})</h2>
                <Button onClick={loadQuestions} variant="secondary"><RefreshCw size={18} className={loading ? 'animate-spin' : ''}/></Button>
              </div>
              <div className="bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-4 text-sm font-semibold text-slate-600">ID</th>
                      <th className="p-4 text-sm font-semibold text-slate-600">Nội dung</th>
                      <th className="p-4 text-sm font-semibold text-slate-600">Loại</th>
                      <th className="p-4 text-sm font-semibold text-slate-600">Mức độ</th>
                      <th className="p-4 text-right text-sm font-semibold text-slate-600">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {questions.map(q => (
                      <tr key={q.exam_id} className="hover:bg-slate-50">
                        <td className="p-4 text-xs font-mono text-slate-500">{q.exam_id}</td>
                        <td className="p-4 text-sm text-slate-800 max-w-lg truncate">{q.question_text}</td>
                        <td className="p-4 text-xs"><span className="px-2 py-1 rounded bg-blue-50 text-blue-700">{q.question_type}</span></td>
                        <td className="p-4 text-xs text-slate-600">{q.level}</td>
                        <td className="p-4 text-right flex gap-2 justify-end">
                          <button onClick={() => setEditingQuestion(q)} className="text-blue-500 hover:bg-blue-50 p-2 rounded" title="Chỉnh sửa"><Edit size={16}/></button>
                          <button onClick={() => handleDelete(q.exam_id)} className="text-red-500 hover:bg-red-50 p-2 rounded" title="Xóa"><Trash2 size={16}/></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STUDENTS TAB */}
          {activeTab === 'students' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
              {/* List */}
              <div className="col-span-1 bg-white rounded-xl shadow border border-slate-200 h-full max-h-[calc(100vh-150px)] flex flex-col">
                <div className="p-4 border-b border-slate-200 font-bold text-slate-700">Danh sách học sinh ({students.length})</div>
                <div className="overflow-y-auto flex-1 p-2">
                  {students.map(s => (
                    <div 
                      key={s.email} 
                      onClick={() => loadStudentResults(s.email)}
                      className={`p-3 rounded-lg cursor-pointer mb-1 transition ${selectedStudent === s.email ? 'bg-teal-50 border border-teal-200' : 'hover:bg-slate-50 border border-transparent'}`}
                    >
                      <div className="font-bold text-slate-800">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.class} • {s.totalScore} điểm</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Details */}
              <div className="col-span-1 lg:col-span-2 bg-white rounded-xl shadow border border-slate-200 h-full max-h-[calc(100vh-150px)] flex flex-col">
                <div className="p-4 border-b border-slate-200 font-bold text-slate-700">
                  {selectedStudent ? `Lịch sử làm bài: ${selectedStudent}` : 'Chọn học sinh để xem chi tiết'}
                </div>
                <div className="overflow-y-auto flex-1 p-4">
                  {loading && selectedStudent ? <div className="text-center py-10"><Loader2 className="animate-spin mx-auto text-teal-600"/></div> : (
                    <div className="space-y-3">
                      {studentResults.map((r, idx) => {
                          const isExpanded = expandedResultId === r.result_id;
                          return (
                            <div key={idx} className={`border rounded-xl transition-all ${isExpanded ? 'bg-white border-teal-200 shadow-md' : 'bg-slate-50 hover:bg-white'}`}>
                                <div 
                                    onClick={() => toggleExpandResult(r.result_id)}
                                    className="p-4 flex justify-between items-center cursor-pointer"
                                >
                                    <div>
                                        <div className="font-bold text-slate-800 flex items-center gap-2">
                                            {r.topic} <span className="font-normal text-xs bg-slate-200 px-1 rounded">Lv.{r.level}</span>
                                            {r.submissionReason !== 'normal' && (
                                              <span title="Có cảnh báo vi phạm">
                                                <AlertTriangle size={16} className="text-red-500" />
                                              </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500">{new Date(r.timestamp).toLocaleString()} • {Math.floor(r.timeSpent/60)}p{r.timeSpent%60}s</div>
                                    </div>
                                    <div className="text-right flex items-center gap-4">
                                        <div>
                                            <div className={`text-xl font-bold ${r.status === 'PASSED' ? 'text-green-600' : 'text-red-500'}`}>{r.percentage}%</div>
                                            <div className="text-xs text-slate-500">{r.score}/{r.total} câu</div>
                                        </div>
                                        {isExpanded ? <ChevronUp size={20} className="text-slate-400"/> : <ChevronDown size={20} className="text-slate-400"/>}
                                    </div>
                                </div>
                                
                                {isExpanded && (
                                    <div className="border-t border-slate-100 p-4 bg-slate-50 rounded-b-xl animate-fade-in">
                                        {/* Violation Warning */}
                                        {r.submissionReason !== 'normal' && (
                                            <div className="mb-4 bg-red-100 border border-red-200 text-red-800 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                                                <AlertTriangle size={16}/>
                                                <span>
                                                    <strong>Cảnh báo:</strong> {r.submissionReason === 'cheat_tab' ? 'Chuyển tab/Rời màn hình' : 'Đăng nhập thiết bị khác'}
                                                </span>
                                            </div>
                                        )}
                                        
                                        {/* Answers List */}
                                        <div className="space-y-3">
                                            {r.answers && r.answers.length > 0 ? (
                                                r.answers.map((ans: any, ansIdx: number) => {
                                                    const qDetail = getQuestionDetails(ans.questionId);
                                                    return (
                                                        <div key={ansIdx} className={`p-3 rounded border ${ans.correct ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                                            <div className="flex justify-between mb-1">
                                                                <span className="text-xs font-bold text-slate-500">Câu {ansIdx + 1}</span>
                                                                <span className={`text-xs font-bold px-2 py-0.5 rounded ${ans.correct ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                                                                    {ans.correct ? 'Đúng' : 'Sai'}
                                                                </span>
                                                            </div>
                                                            <div className="text-sm mb-2 text-slate-800">
                                                                {qDetail ? <MathText content={qDetail.question_text}/> : <span className="italic text-gray-400">Câu hỏi đã bị xóa (ID: {ans.questionId})</span>}
                                                            </div>
                                                            <div className="text-xs grid grid-cols-2 gap-2">
                                                                <div>
                                                                    <span className="text-slate-500 block">Học sinh chọn:</span>
                                                                    <span className="font-mono font-bold">{ans.userAnswer || '(Trống)'}</span>
                                                                </div>
                                                                {!ans.correct && qDetail && (
                                                                    <div>
                                                                        <span className="text-slate-500 block">Đáp án đúng:</span>
                                                                        <span className="font-mono font-bold text-green-700">{qDetail.answer_key}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="text-center text-slate-400 italic py-2">Không có dữ liệu chi tiết</div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                          );
                      })}
                      {selectedStudent && studentResults.length === 0 && <div className="text-center text-slate-400 py-10">Chưa có bài làm nào</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* PDF UPLOAD & OCR TAB (NEW) */}
          {activeTab === 'pdf-upload' && (
              <div className="max-w-5xl mx-auto space-y-6">
                 <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-slate-800">Tạo đề thi từ PDF (Smart OCR)</h2>
                    {pdfState === AppState.IDLE && (
                        <div className="relative">
                            <input 
                                type="file" 
                                accept=".pdf" 
                                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                onChange={handlePdfSelect}
                                ref={pdfInputRef}
                            />
                            <Button><UploadCloud className="mr-2 inline" size={18}/> Chọn file PDF</Button>
                        </div>
                    )}
                 </div>

                 {/* 1. UPLOAD UI */}
                 {pdfState === AppState.IDLE && !pdfFile && (
                    <div className="border-2 border-dashed border-slate-300 rounded-2xl p-12 text-center bg-white hover:bg-slate-50 transition-colors">
                        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <FileUp size={32}/>
                        </div>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">Tải lên đề thi PDF</h3>
                        <p className="text-slate-500 mb-6">Hệ thống sẽ tự động nhận diện văn bản, công thức Toán và hình ảnh.</p>
                        <Button onClick={() => pdfInputRef.current?.click()} variant="outline">Chọn file từ máy tính</Button>
                    </div>
                 )}

                 {pdfFile && pdfState === AppState.IDLE && (
                    <div className="bg-white p-6 rounded-xl shadow border border-slate-200 text-center">
                        <div className="flex items-center justify-center gap-3 mb-6 text-xl font-bold text-slate-700">
                            <FileText size={24} className="text-red-500"/> {pdfFile.name}
                        </div>
                        <Button onClick={handlePdfUpload} className="bg-blue-600 hover:bg-blue-700">
                             <Wand2 className="mr-2 inline" size={18}/> Bắt đầu Xử lý OCR
                        </Button>
                    </div>
                 )}

                 {/* 2. LOADING STATES */}
                 {(pdfState === AppState.UPLOADING_OCR || pdfState === AppState.CORRECTING || generating) && (
                    <div className="bg-white p-12 rounded-xl shadow border border-slate-200 text-center">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4"/>
                        <h3 className="text-xl font-bold text-slate-700 mb-2">
                            {pdfState === AppState.UPLOADING_OCR ? 'Đang tải lên & OCR...' : 
                             pdfState === AppState.CORRECTING ? 'AI đang sửa lỗi & định dạng LaTeX...' : 
                             'Đang trích xuất câu hỏi...'}
                        </h3>
                        <p className="text-slate-500">Vui lòng đợi trong giây lát, không tắt trình duyệt.</p>
                    </div>
                 )}

                 {/* 3. RESULT & TOOLS */}
                 {pdfOcrResult && pdfState === AppState.OCR_COMPLETE && !generating && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
                        {/* LEFT: MARKDOWN PREVIEW */}
                        <div className="bg-white rounded-xl shadow border border-slate-200 flex flex-col h-[80vh]">
                            <div className="p-4 border-b flex justify-between items-center bg-slate-50 rounded-t-xl">
                                <div className="font-bold text-slate-700 flex items-center gap-2">
                                    {correctedPdfText ? <Sparkles size={16} className="text-yellow-500"/> : <FileText size={16}/>}
                                    {correctedPdfText ? 'Văn bản đã sửa lỗi (AI)' : 'Kết quả OCR thô'}
                                </div>
                                <div className="flex gap-2">
                                    {!correctedPdfText && (
                                        <button onClick={handlePdfCorrection} className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200 font-bold flex items-center gap-1">
                                            <Wand2 size={12}/> AI Sửa lỗi
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto p-6 markdown-body text-sm text-slate-900 bg-white">
                                <ReactMarkdown>{correctedPdfText || pdfOcrResult.allMarkdownDataUri}</ReactMarkdown>
                            </div>
                        </div>

                        {/* RIGHT: EXTRACTION TOOLS */}
                        <div className="space-y-6 h-[80vh] overflow-y-auto pr-2">
                            {/* CONFIG PANEL */}
                            <div className="bg-white p-6 rounded-xl shadow border border-blue-200">
                                <h3 className="font-bold text-blue-800 mb-4 flex items-center gap-2"><Settings size={20}/> Cấu hình Trích xuất</h3>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Khối lớp</label>
                                        <select className="w-full p-2 border rounded bg-slate-50 text-slate-900" value={pdfConfig.grade} onChange={e => setPdfConfig({...pdfConfig, grade: Number(e.target.value)})}>
                                            {GRADES.map(g => <option key={g} value={g}>Lớp {g}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chủ đề</label>
                                        <input className="w-full p-2 border rounded bg-slate-50 text-slate-900" value={pdfConfig.topic} onChange={e => setPdfConfig({...pdfConfig, topic: e.target.value})} />
                                    </div>
                                </div>
                                <Button onClick={handleExtractQuestions} disabled={!correctedPdfText} fullWidth className="bg-blue-600 hover:bg-blue-700">
                                    <Database className="mr-2 inline" size={18}/> Trích xuất câu hỏi từ văn bản
                                </Button>
                                {!correctedPdfText && <p className="text-xs text-red-500 mt-2 text-center">* Cần chạy "AI Sửa lỗi" trước khi trích xuất</p>}
                            </div>

                            {/* EXTRACTED QUESTIONS LIST */}
                            {extractedQuestions.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-bold text-slate-700">Đã tìm thấy {extractedQuestions.length} câu hỏi</h3>
                                        <Button onClick={handleSaveAllExtracted} size="sm" className="bg-green-600 hover:bg-green-700 text-sm py-1">
                                            <Save size={16} className="mr-1 inline"/> Lưu tất cả vào kho
                                        </Button>
                                    </div>
                                    
                                    {extractedQuestions.map((q, idx) => (
                                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-sm">
                                            <div className="font-bold text-teal-700 mb-2 flex justify-between">
                                                <span>Câu {idx + 1}</span>
                                                <span className="text-xs bg-gray-100 px-2 py-1 rounded text-slate-600">{q.question_type}</span>
                                            </div>
                                            <div className="mb-2 text-slate-900 font-medium"><MathText content={q.question_text || ''}/></div>
                                            {q.image_id && (
                                                <div className="mb-2 p-2 bg-slate-100 rounded text-xs text-slate-500 flex items-center gap-2">
                                                    <ImageIcon size={14}/> Có hình ảnh: {q.image_id}
                                                </div>
                                            )}
                                            
                                            {/* RENDER OPTIONS BASED ON TYPE */}
                                            {q.question_type === 'Trắc nghiệm' && (
                                                <div className="grid grid-cols-2 gap-2 mb-2">
                                                    <div className={`p-2 border rounded text-slate-900 ${q.answer_key === 'A' ? 'bg-green-50 border-green-300 font-bold' : ''}`}>A. <MathText content={q.option_A || ''}/></div>
                                                    <div className={`p-2 border rounded text-slate-900 ${q.answer_key === 'B' ? 'bg-green-50 border-green-300 font-bold' : ''}`}>B. <MathText content={q.option_B || ''}/></div>
                                                    <div className={`p-2 border rounded text-slate-900 ${q.answer_key === 'C' ? 'bg-green-50 border-green-300 font-bold' : ''}`}>C. <MathText content={q.option_C || ''}/></div>
                                                    <div className={`p-2 border rounded text-slate-900 ${q.answer_key === 'D' ? 'bg-green-50 border-green-300 font-bold' : ''}`}>D. <MathText content={q.option_D || ''}/></div>
                                                </div>
                                            )}

                                            {q.question_type === 'Đúng/Sai' && (
                                                <div className="grid grid-cols-1 gap-1 mb-2">
                                                    <div className="p-2 border rounded bg-slate-50 text-slate-900">a) <MathText content={q.option_A || ''}/></div>
                                                    <div className="p-2 border rounded bg-slate-50 text-slate-900">b) <MathText content={q.option_B || ''}/></div>
                                                    <div className="p-2 border rounded bg-slate-50 text-slate-900">c) <MathText content={q.option_C || ''}/></div>
                                                    <div className="p-2 border rounded bg-slate-50 text-slate-900">d) <MathText content={q.option_D || ''}/></div>
                                                </div>
                                            )}

                                            {q.question_type === 'Trả lời ngắn' && (
                                                <div className="mb-2 p-2 bg-blue-50 border border-blue-100 rounded text-slate-900">
                                                    <strong>Đáp số:</strong> {q.answer_key || '(Chưa có)'}
                                                </div>
                                            )}

                                            <div className="text-xs text-slate-700 bg-yellow-50 p-2 rounded border border-yellow-100">
                                                <strong>Lời giải:</strong> <MathText content={q.solution || 'Chưa có lời giải'}/>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                 )}
              </div>
          )}

          {/* AI GEN TAB */}
          {activeTab === 'ai-gen' && (
            <div className="max-w-4xl mx-auto">
              {/* ... (Keep existing code for AI Gen Tab) ... */}
              <div className="flex justify-between items-center mb-6">
                 <h2 className="text-2xl font-bold text-slate-800">AI Generator</h2>
                 <div className="flex gap-2">
                     <button 
                         onClick={() => setShowResourceLibrary(true)}
                         className={`px-4 py-2 rounded-lg font-medium text-sm border flex items-center gap-2 transition ${showResourceLibrary ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                     >
                         <Library size={18}/> Quản lý Kho đề thi
                     </button>
                 </div>
              </div>
              
              {/* RESOURCE LIBRARY VIEW */}
              {showResourceLibrary ? (
                 <div className="bg-white p-6 rounded-xl shadow border border-slate-200 mb-6 animate-fade-in">
                     <div className="flex justify-between items-center mb-6 border-b pb-4">
                         <h3 className="text-xl font-bold text-blue-800 flex items-center gap-2"><Database size={24}/> Kho tài liệu & Đề thi ({documents.length})</h3>
                         <button onClick={() => setShowResourceLibrary(false)} className="text-slate-500 hover:text-blue-600">Đóng kho</button>
                     </div>

                     {/* Upload Area */}
                     <div className="mb-8">
                         <h4 className="font-bold text-slate-700 mb-2">Thêm tài liệu mới (PDF / Ảnh)</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div 
                                className="border-2 border-dashed border-blue-300 rounded-xl p-6 text-center bg-blue-50/50 hover:bg-blue-50 transition-colors cursor-pointer flex flex-col items-center justify-center h-48"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    className="hidden" 
                                    accept="image/*,application/pdf"
                                    onChange={handleFileSelect}
                                />
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-3">
                                    <FileUp size={24}/>
                                </div>
                                {ocrFile ? (
                                    <div>
                                        <p className="font-bold text-blue-800 text-sm truncate max-w-[200px]">{ocrFile.name}</p>
                                        <p className="text-xs text-blue-600">Đã chọn</p>
                                    </div>
                                ) : (
                                    <div>
                                        <p className="font-bold text-slate-700 text-sm">Tải lên đề thi (Ảnh/PDF)</p>
                                        <p className="text-xs text-slate-500 mt-1">Hỗ trợ trích xuất văn bản & Toán</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col h-48">
                                <textarea 
                                    className="flex-1 w-full p-3 border rounded-lg font-mono text-xs bg-slate-50 text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-3"
                                    placeholder="Nội dung văn bản sau khi OCR sẽ hiện ở đây..."
                                    value={ocrText}
                                    onChange={(e) => setOcrText(e.target.value)}
                                ></textarea>
                                <div className="flex gap-2">
                                    <Button onClick={handlePerformOCR} disabled={ocrLoading || !ocrFile} className="flex-1 bg-blue-600 py-2 text-sm" variant="primary">
                                        {ocrLoading ? <Loader2 className="animate-spin inline mr-1" size={16}/> : <ScanLine className="inline mr-1" size={16}/>} 
                                        1. Quét (OCR)
                                    </Button>
                                    <Button onClick={handleSaveDocument} disabled={ocrLoading || !ocrText} className="flex-1 bg-green-600 hover:bg-green-700 py-2 text-sm" variant="primary">
                                        <Save className="inline mr-1" size={16}/> 2. Lưu vào kho
                                    </Button>
                                </div>
                            </div>
                         </div>
                     </div>

                     {/* Documents List */}
                     <div>
                         <h4 className="font-bold text-slate-700 mb-2">Tài liệu đã lưu</h4>
                         <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden max-h-64 overflow-y-auto">
                             {documents.length === 0 ? (
                                 <div className="p-4 text-center text-slate-400 italic">Chưa có tài liệu nào trong kho.</div>
                             ) : (
                                 <table className="w-full text-left text-sm">
                                     <thead className="bg-slate-100 text-slate-600">
                                         <tr>
                                             <th className="p-3">Tên tài liệu</th>
                                             <th className="p-3">Ngày tạo</th>
                                             <th className="p-3 text-right">Thao tác</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-200">
                                         {documents.map(doc => (
                                             <tr key={doc.id} className="hover:bg-white">
                                                 <td className="p-3 font-medium text-slate-800">{doc.name}</td>
                                                 <td className="p-3 text-slate-500">{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                                                 <td className="p-3 text-right">
                                                     <button onClick={() => handleDeleteDocument(doc.id)} className="text-red-500 hover:text-red-700"><Trash2 size={16}/></button>
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             )}
                         </div>
                     </div>
                 </div>
              ) : (
                 // GENERATOR VIEW
                 <div className="bg-white p-6 rounded-xl shadow border border-slate-200 mb-6 animate-fade-in">
                    {/* Header Tabs */}
                    <div className="flex bg-slate-100 p-1 rounded-lg mb-6 w-fit">
                        <button onClick={() => setGenMode('question')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${genMode === 'question' ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}>Tạo Câu Hỏi</button>
                        <button onClick={() => setGenMode('theory')} className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${genMode === 'theory' ? 'bg-white shadow text-purple-700' : 'text-slate-500'}`}>Tạo Lý Thuyết</button>
                    </div>

                    {genMode === 'question' && (
                        <div className="mb-6 border-b pb-6">
                            <label className="block text-sm font-bold text-slate-700 mb-3">Nguồn dữ liệu:</label>
                            <div className="grid grid-cols-2 gap-4">
                                <label className={`flex items-center gap-2 cursor-pointer p-4 rounded-xl border-2 transition-all ${inputMode === 'manual' ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-sm' : 'border-slate-200 hover:border-teal-200 bg-white text-slate-600'}`}>
                                    <input type="radio" name="input_mode" checked={inputMode === 'manual'} onChange={() => setInputMode('manual')} className="hidden"/>
                                    <PenTool size={24} className="mb-0.5"/>
                                    <div>
                                        <div className="font-bold">Nhập chủ đề thủ công</div>
                                        <div className="text-xs opacity-70">AI tự tạo dựa trên topic</div>
                                    </div>
                                </label>
                                <label className={`flex items-center gap-2 cursor-pointer p-4 rounded-xl border-2 transition-all ${inputMode === 'select-file' ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-sm' : 'border-slate-200 hover:border-teal-200 bg-white text-slate-600'}`}>
                                    <input type="radio" name="input_mode" checked={inputMode === 'select-file'} onChange={() => setInputMode('select-file')} className="hidden"/>
                                    <Database size={24} className="mb-0.5"/>
                                    <div>
                                        <div className="font-bold">Chọn từ Kho đề thi</div>
                                        <div className="text-xs opacity-70">Sử dụng tài liệu đã OCR</div>
                                    </div>
                                </label>
                            </div>

                            {inputMode === 'select-file' && (
                                <div className="mt-4 animate-fade-in">
                                    <select 
                                        className="w-full p-3 border rounded-lg bg-white focus:ring-2 focus:ring-teal-500 outline-none text-slate-900"
                                        value={selectedDocId}
                                        onChange={(e) => setSelectedDocId(e.target.value)}
                                    >
                                        <option value="">-- Chọn tài liệu từ kho --</option>
                                        {documents.map(doc => (
                                            <option key={doc.id} value={doc.id}>{doc.name} (Tải lên: {new Date(doc.uploadedAt).toLocaleDateString()})</option>
                                        ))}
                                    </select>
                                    <div className="text-right mt-1">
                                        <button onClick={() => setShowResourceLibrary(true)} className="text-xs text-blue-600 hover:underline">+ Quản lý kho tài liệu</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Khối lớp</label>
                        <select className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.grade} onChange={e => setAiConfig({...aiConfig, grade: Number(e.target.value)})}>
                          {GRADES.map(g => (
                              <option key={g} value={g}>Lớp {g}</option>
                          ))}
                        </select>
                      </div>
                      
                      {genMode === 'question' ? (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Loại câu hỏi</label>
                          <select className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.type} onChange={e => setAiConfig({...aiConfig, type: e.target.value})}>
                            <option>Trắc nghiệm</option><option>Đúng/Sai</option><option>Trả lời ngắn</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                           <label className="block text-sm font-medium text-slate-700 mb-1">Level (Số)</label>
                           <select className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.numericLevel} onChange={e => setAiConfig({...aiConfig, numericLevel: Number(e.target.value)})}>
                              {[1,2,3,4,5].map(l => <option key={l} value={l}>Level {l}</option>)}
                           </select>
                        </div>
                      )}

                      <div className="col-span-2">
                        <label className="block text-sm font-medium text-slate-700 mb-1">Chủ đề {inputMode === 'select-file' && <span className="text-teal-600 font-normal text-xs">(AI sẽ kết hợp chủ đề này với nội dung file)</span>}</label>
                        <input type="text" className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.topic} onChange={e => setAiConfig({...aiConfig, topic: e.target.value})} placeholder="VD: Hàm số, Tích phân..." />
                      </div>
                      
                      {genMode === 'question' && (
                         <div className="col-span-2 grid grid-cols-2 gap-4">
                           <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Mức độ (Text)</label>
                              <select className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.level} onChange={e => setAiConfig({...aiConfig, level: e.target.value})}>
                                <option>Nhận biết</option><option>Thông hiểu</option><option>Vận dụng</option><option>Vận dụng cao</option>
                              </select>
                           </div>
                           <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Quiz Level (Số)</label>
                               <select className="w-full p-2 border rounded-lg text-slate-900 bg-white" value={aiConfig.numericLevel} onChange={e => setAiConfig({...aiConfig, numericLevel: Number(e.target.value)})}>
                                  {[1,2,3,4,5].map(l => <option key={l} value={l}>Level {l}</option>)}
                               </select>
                           </div>
                         </div>
                      )}
                    </div>

                    <Button onClick={handleGenerateAI} disabled={generating || (inputMode === 'select-file' && !selectedDocId)} fullWidth className={genMode === 'theory' ? 'bg-purple-600 hover:bg-purple-700' : ''}>
                      {generating ? <><Loader2 className="animate-spin mr-2 inline"/> Đang xử lý...</> : <BrainCircuit className="mr-2 inline"/>} 
                      {genMode === 'question' 
                        ? (inputMode === 'select-file' ? 'Tạo câu hỏi từ Tài liệu đã chọn' : 'Tạo câu hỏi từ Chủ đề') 
                        : 'Tạo lý thuyết'}
                    </Button>
                 </div>
              )}

              {/* GENERATED PREVIEW */}
              {generatedQuestion && genMode === 'question' && !showResourceLibrary && (
                <div className="bg-white p-6 rounded-xl shadow border border-teal-200 animate-fade-in">
                  <h3 className="font-bold text-teal-800 mb-4 border-b pb-2">Xem trước câu hỏi (ID: Q{Date.now()})</h3>
                  <div className="mb-4">
                    <div className="font-medium text-slate-700 mb-2">Đề bài:</div>
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-900"><MathText content={generatedQuestion.question_text}/></div>
                  </div>
                  
                  {generatedQuestion.question_type === 'Trắc nghiệm' && (
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      {['A','B','C','D'].map(opt => (
                        <div key={opt} className={`p-2 border rounded text-slate-900 ${generatedQuestion.answer_key === opt ? 'bg-green-50 border-green-300' : 'bg-white'}`}>
                          <span className="font-bold">{opt}.</span> <MathText content={generatedQuestion[`option_${opt}`]}/>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* UI MỚI CHO CÂU HỎI ĐÚNG/SAI */}
                  {generatedQuestion.question_type === 'Đúng/Sai' && (
                      <div className="mb-4 space-y-2">
                        <div className="grid grid-cols-12 gap-2 font-bold text-slate-700 border-b pb-2">
                            <div className="col-span-1 text-center">Ý</div>
                            <div className="col-span-7">Nội dung mệnh đề</div>
                            <div className="col-span-4 text-center">Đáp án Đúng/Sai</div>
                        </div>
                        {['A', 'B', 'C', 'D'].map((opt, idx) => {
                            const currentKeys = (generatedQuestion.answer_key || "S-S-S-S").split('-');
                            const isTrue = currentKeys[idx] === 'Đ';
                            return (
                                <div key={opt} className="grid grid-cols-12 gap-2 items-center bg-slate-50 p-2 rounded border border-slate-200 text-slate-900">
                                    <div className="col-span-1 font-bold text-center text-teal-700">{opt}</div>
                                    <div className="col-span-7 text-sm">
                                         <MathText content={generatedQuestion[`option_${opt}`] || ''} />
                                    </div>
                                    <div className="col-span-4 flex justify-center gap-2">
                                        <button
                                            onClick={() => updateTrueFalseKey('generated', idx, 'Đ')}
                                            className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${isTrue ? 'bg-teal-600 text-white border-teal-600 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-teal-300'}`}
                                        >
                                            Đúng
                                        </button>
                                        <button
                                            onClick={() => updateTrueFalseKey('generated', idx, 'S')}
                                            className={`px-4 py-2 rounded-lg text-sm font-bold border transition-all ${!isTrue ? 'bg-orange-500 text-white border-orange-500 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-orange-300'}`}
                                        >
                                            Sai
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                      </div>
                  )}

                  <div className="mb-6">
                    <div className="font-medium text-slate-700 mb-2">Lời giải:</div>
                    <div className="p-3 bg-yellow-50 rounded-lg text-sm text-slate-900 border border-yellow-100"><MathText content={generatedQuestion.solution}/></div>
                  </div>

                  <div className="flex gap-3">
                    <Button onClick={handleSaveGenerated} disabled={loading} className="flex-1">
                      <Save className="mr-2 inline" size={18}/> Lưu câu hỏi
                    </Button>
                    <Button onClick={() => setGeneratedQuestion(null)} variant="secondary" className="flex-1">Hủy</Button>
                  </div>
                </div>
              )}

              {generatedTheory && genMode === 'theory' && !showResourceLibrary && (
                <div className="bg-white p-6 rounded-xl shadow border border-purple-200 animate-fade-in">
                   <div className="bg-purple-600 text-white p-4 -mx-6 -mt-6 rounded-t-xl mb-6">
                      <h3 className="font-bold text-lg">{generatedTheory.title}</h3>
                      <p className="text-sm opacity-90">{generatedTheory.topic} - Grade {generatedTheory.grade} - Level {generatedTheory.level}</p>
                   </div>
                   
                   <div className="mb-6 prose max-w-none">
                      <h4 className="font-bold text-slate-700">Nội dung:</h4>
                      <div className="p-4 bg-slate-50 rounded-lg"><MathText content={generatedTheory.content} block/></div>
                   </div>

                   {generatedTheory.examples && (
                     <div className="mb-6">
                        <h4 className="font-bold text-blue-700">Ví dụ:</h4>
                        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100"><MathText content={generatedTheory.examples} block/></div>
                     </div>
                   )}

                   {generatedTheory.tips && (
                     <div className="mb-6">
                        <h4 className="font-bold text-orange-700">Mẹo:</h4>
                        <div className="p-4 bg-orange-50 rounded-lg border border-orange-100 text-sm italic"><MathText content={generatedTheory.tips}/></div>
                     </div>
                   )}

                   <div className="flex gap-3">
                    <Button onClick={handleSaveGenerated} disabled={loading} className="flex-1 bg-purple-600 hover:bg-purple-700 shadow-purple-200">
                      <Save className="mr-2 inline" size={18}/> Lưu lý thuyết
                    </Button>
                    <Button onClick={() => setGeneratedTheory(null)} variant="secondary" className="flex-1">Hủy</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* EDIT MODAL */}
      {editingQuestion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="p-4 border-b flex justify-between items-center bg-teal-50">
                    <div className="flex items-center gap-2 text-teal-800 font-bold text-lg">
                        <Edit size={20}/> Chỉnh sửa câu hỏi <span className="text-xs font-mono bg-white px-2 py-0.5 rounded border ml-2">{editingQuestion.exam_id}</span>
                    </div>
                    <button onClick={() => setEditingQuestion(null)} className="text-slate-400 hover:text-red-500 transition-colors"><XCircle size={24}/></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/50">
                    {/* Left Column: Settings */}
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Khối lớp</label>
                                <select 
                                    className="w-full p-2 border rounded-lg bg-white text-slate-900"
                                    value={editingQuestion.grade}
                                    onChange={(e) => handleEditFieldChange('grade', Number(e.target.value))}
                                >
                                    {GRADES.map(g => <option key={g} value={g}>Lớp {g}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Chủ đề</label>
                                <input 
                                    className="w-full p-2 border rounded-lg bg-white text-slate-900"
                                    value={editingQuestion.topic || ''}
                                    onChange={(e) => handleEditFieldChange('topic', e.target.value)}
                                />
                            </div>
                        </div>

                         <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mức độ</label>
                                <select 
                                    className="w-full p-2 border rounded-lg bg-white text-slate-900"
                                    value={editingQuestion.level || 'Thông hiểu'}
                                    onChange={(e) => handleEditFieldChange('level', e.target.value)}
                                >
                                    <option>Nhận biết</option><option>Thông hiểu</option><option>Vận dụng</option><option>Vận dụng cao</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Loại câu hỏi</label>
                                <select 
                                    className="w-full p-2 border rounded-lg bg-white text-slate-900"
                                    value={editingQuestion.question_type || 'Trắc nghiệm'}
                                    onChange={(e) => handleEditFieldChange('question_type', e.target.value)}
                                >
                                    <option>Trắc nghiệm</option><option>Đúng/Sai</option><option>Trả lời ngắn</option>
                                </select>
                            </div>
                        </div>

                         <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                Nội dung câu hỏi (LaTeX) <Eye size={14} className="text-teal-600"/>
                            </label>
                            <textarea 
                                className="w-full p-3 border rounded-lg bg-white font-mono text-sm h-32 focus:ring-2 focus:ring-teal-500 outline-none text-slate-900"
                                value={editingQuestion.question_text || ''}
                                onChange={(e) => handleEditFieldChange('question_text', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                Lời giải chi tiết <Eye size={14} className="text-teal-600"/>
                            </label>
                            <textarea 
                                className="w-full p-3 border rounded-lg bg-white font-mono text-sm h-32 focus:ring-2 focus:ring-teal-500 outline-none text-slate-900"
                                value={editingQuestion.solution || ''}
                                onChange={(e) => handleEditFieldChange('solution', e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Right Column: Content & Preview */}
                    <div className="space-y-4">
                        {/* Live Preview Question */}
                        <div className="bg-white p-4 rounded-xl border shadow-sm">
                            <div className="text-xs font-bold text-teal-600 uppercase mb-2">Xem trước câu hỏi</div>
                            <div className="text-slate-800"><MathText content={editingQuestion.question_text || ''} /></div>
                        </div>

                        {/* Options Section */}
                        <div className="bg-white p-4 rounded-xl border shadow-sm space-y-3">
                             <div className="flex justify-between items-center mb-2">
                                <div className="text-xs font-bold text-teal-600 uppercase">Các lựa chọn / Đáp án</div>
                                {editingQuestion.question_type !== 'Đúng/Sai' && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-500">Đáp án đúng:</span>
                                        <input 
                                            className="w-20 p-1 border rounded text-center font-bold text-teal-700 text-slate-900 bg-white"
                                            value={editingQuestion.answer_key || ''}
                                            onChange={(e) => handleEditFieldChange('answer_key', e.target.value)}
                                            placeholder="VD: A"
                                        />
                                    </div>
                                )}
                             </div>
                             
                             {/* GIAO DIỆN CHỈNH SỬA CHO ĐÚNG/SAI */}
                             {editingQuestion.question_type === 'Đúng/Sai' ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-12 gap-2 text-xs font-bold text-slate-500 uppercase pb-1">
                                        <div className="col-span-1 text-center">Ý</div>
                                        <div className="col-span-8">Nội dung mệnh đề</div>
                                        <div className="col-span-3 text-center">Đáp án</div>
                                    </div>
                                    {['A', 'B', 'C', 'D'].map((opt, idx) => {
                                        const currentKeys = (editingQuestion.answer_key || "S-S-S-S").split('-');
                                        const isTrue = currentKeys[idx] === 'Đ';
                                        
                                        return (
                                            <div key={opt} className="grid grid-cols-12 gap-2 items-start bg-slate-50/50 p-2 rounded border border-slate-100">
                                                <div className="col-span-1 pt-2 font-bold text-center text-slate-500">{opt}</div>
                                                <div className="col-span-8">
                                                    <textarea 
                                                        rows={2}
                                                        className="w-full p-2 border rounded text-sm font-mono focus:ring-1 focus:ring-teal-500 outline-none text-slate-900 bg-white"
                                                        value={(editingQuestion as any)[`option_${opt}`] || ''}
                                                        onChange={(e) => handleEditFieldChange(`option_${opt}` as any, e.target.value)}
                                                        placeholder={`Nội dung mệnh đề ${opt}...`}
                                                    />
                                                    <div className="mt-1 text-xs text-slate-500 overflow-hidden">
                                                        <MathText content={(editingQuestion as any)[`option_${opt}`] || ''} />
                                                    </div>
                                                </div>
                                                <div className="col-span-3 flex flex-col items-center justify-center gap-2 h-full">
                                                    <button
                                                        onClick={() => updateTrueFalseKey('editing', idx, 'Đ')}
                                                        className={`w-full px-2 py-1.5 mb-1 rounded text-xs font-bold border transition-all ${isTrue ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-400 border-slate-200 hover:border-teal-300'}`}
                                                    >
                                                        Đúng
                                                    </button>
                                                    <button
                                                        onClick={() => updateTrueFalseKey('editing', idx, 'S')}
                                                        className={`w-full px-2 py-1.5 rounded text-xs font-bold border transition-all ${!isTrue ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-400 border-slate-200 hover:border-orange-300'}`}
                                                    >
                                                        Sai
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                             ) : (
                                 // GIAO DIỆN CHỈNH SỬA CHO CÂU HỎI KHÁC
                                 ['A', 'B', 'C', 'D'].map(opt => (
                                     <div key={opt} className="grid grid-cols-12 gap-2 items-start">
                                         <div className="col-span-1 pt-2 font-bold text-center text-slate-500">{opt}</div>
                                         <div className="col-span-5">
                                             <textarea 
                                                rows={2}
                                                className="w-full p-2 border rounded text-sm font-mono focus:ring-1 focus:ring-teal-500 outline-none text-slate-900 bg-white"
                                                value={(editingQuestion as any)[`option_${opt}`] || ''}
                                                onChange={(e) => handleEditFieldChange(`option_${opt}` as any, e.target.value)}
                                                placeholder={`Nội dung đáp án ${opt}...`}
                                             />
                                         </div>
                                         <div className="col-span-6 p-2 bg-slate-50 rounded border text-sm overflow-hidden flex items-center text-slate-900">
                                             <MathText content={(editingQuestion as any)[`option_${opt}`] || ''} />
                                         </div>
                                     </div>
                                 ))
                             )}
                        </div>

                         {/* Live Preview Solution */}
                         <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-200 shadow-sm">
                            <div className="text-xs font-bold text-yellow-700 uppercase mb-2">Xem trước lời giải</div>
                            <div className="text-slate-800 text-sm"><MathText content={editingQuestion.solution || ''} /></div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-white flex justify-end gap-3">
                    <Button onClick={() => setEditingQuestion(null)} variant="secondary">Hủy bỏ</Button>
                    <Button onClick={handleSaveEdit} disabled={loading}>
                        {loading ? <Loader2 className="animate-spin mr-2 inline" size={18}/> : <Save className="mr-2 inline" size={18}/>}
                        Lưu thay đổi
                    </Button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};