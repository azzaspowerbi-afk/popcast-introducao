import { useState, useMemo, useRef, ChangeEvent, useEffect, FormEvent, Component, ErrorInfo, ReactNode } from 'react';
import { BarChart2, Eye, CheckCircle2, FileText, Upload, X, Mic, Play, Pause, ChevronLeft, ChevronRight, Moon, Sun, ChevronDown, LogIn, LogOut, User as UserIcon, Music, Link as LinkIcon, Save, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Page, pdfjs } from 'react-pdf';
import { auth, googleProvider, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp, getDocFromServer } from 'firebase/firestore';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Helper to transform common cloud storage links to direct PDF links
const getDirectPdfUrl = (url: string | null) => {
  if (!url) return null;
  if (!url.startsWith('http')) return url; // Blob URLs or local paths

  try {
    let directUrl = url;
    // Google Drive
    if (url.includes('drive.google.com')) {
      // Handle various Drive URL formats: /file/d/ID/view, /d/ID/edit, ?id=ID, etc.
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                    url.match(/id=([a-zA-Z0-9_-]+)/) ||
                    url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        directUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
      }
    }
    
    // Dropbox
    if (url.includes('dropbox.com')) {
      directUrl = url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '').replace('?dl=1', '');
    }

    // Use proxy to bypass CORS for all external URLs
    return `/api/proxy-pdf?url=${encodeURIComponent(directUrl)}`;
  } catch (e) {
    // Not a valid URL, return as is
  }
  
  return url;
};

// Import react-pdf styles
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const ADMIN_EMAIL = 'azzaspowerbi@gmail.com';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<any, any> {
  public state: any;
  public props: any;

  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Ocorreu um erro inesperado.";
      try {
        if (this.state.error?.message) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.error.includes('Missing or insufficient permissions')) {
            errorMessage = "Você não tem permissão para realizar esta ação. Verifique se está logado como administrador.";
          }
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4">
          <div className="bg-[#1e293b] border border-white/10 p-8 rounded-3xl max-w-md w-full text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Ops! Algo deu errado</h2>
            <p className="text-slate-400 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-[#A0C6ED] text-[#0f172a] rounded-xl font-bold hover:bg-[#8eb2d6] transition-all"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function AppContent() {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState('Introdução Dos Processos');
  const [episodeDescription, setEpisodeDescription] = useState('Um papo introdutório sobre como estoque, recebimento, e-commerce e otimização se encaixam para fazer o CD funcionar.');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [tempPdfUrl, setTempPdfUrl] = useState('');
  const [pdfMode, setPdfMode] = useState<'file' | 'link'>('file');
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [soundcloudUrl, setSoundcloudUrl] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<'file' | 'soundcloud'>('file');
  const [tempSoundcloudUrl, setTempSoundcloudUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const isAdmin = user?.email === ADMIN_EMAIL;

  const pdfFile = useMemo(() => ({ url: pdfUrl || '' }), [pdfUrl]);

  // Listen for episode data from Firestore
  useEffect(() => {
    const episodeDoc = doc(db, 'episodes', 'current');
    const unsubscribe = onSnapshot(episodeDoc, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setEpisodeTitle(data.title || 'Introdução Dos Processos');
        setEpisodeDescription(data.description || '');
        
        if (data.soundcloudUrl) {
          setSoundcloudUrl(data.soundcloudUrl);
          setAudioMode('soundcloud');
        }
        
        if (data.pdfUrl) {
          // Store the original URL in a way we can use it for saving later if needed
          // but for the viewer we use the direct/proxied URL
          setPdfUrl(getDirectPdfUrl(data.pdfUrl));
          setTempPdfUrl(data.pdfUrl);
          setPdfMode('link');
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'episodes/current');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveEpisode = async () => {
    if (!isAdmin || !user) return;
    
    setIsSaving(true);
    try {
      // When saving, we want to keep the original URL if it's a link
      // If pdfUrl is a proxy URL, we should use the tempPdfUrl which holds the original
      const urlToSave = pdfMode === 'link' ? tempPdfUrl : '';
      
      await setDoc(doc(db, 'episodes', 'current'), {
        title: episodeTitle,
        description: episodeDescription,
        soundcloudUrl: soundcloudUrl || '',
        pdfUrl: urlToSave,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      });
      showToast('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'episodes/current');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      showToast('Login realizado com sucesso!');
    } catch (error) {
      console.error('Login error:', error);
      showToast('Erro ao realizar login.', 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showToast('Logout realizado com sucesso!');
    } catch (error) {
      console.error('Logout error:', error);
      showToast('Erro ao realizar logout.', 'error');
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handlePdfChange = (e: ChangeEvent<HTMLInputElement> | File) => {
    if (!isAdmin) {
      showToast('Apenas o administrador pode alterar o PDF.', 'error');
      return;
    }
    const file = e instanceof File ? e : e.target.files?.[0];
    if (file) {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      
      if (isPdf) {
        const url = URL.createObjectURL(file);
        setPdfUrl(url);
        setPdfMode('file');
        showToast('PDF carregado temporariamente! Use "LINK PDF" para fixar permanentemente.', 'success');
        if (!(e instanceof File)) e.target.value = '';
      } else {
        showToast('Por favor, selecione um arquivo PDF válido.', 'error');
      }
    }
  };

  const handlePdfUrlSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !user) return;
    
    if (tempPdfUrl.startsWith('http') || tempPdfUrl.startsWith('/')) {
      const directUrl = getDirectPdfUrl(tempPdfUrl);
      setPdfUrl(directUrl);
      setPdfMode('link');
      
      // Auto-save to Firestore for persistence
      setIsSaving(true);
      try {
        await setDoc(doc(db, 'episodes', 'current'), {
          pdfUrl: tempPdfUrl, // Keep original URL in DB
          updatedAt: serverTimestamp(),
          updatedBy: user.uid
        }, { merge: true });
        showToast('Link do PDF fixado permanentemente!');
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'episodes/current');
      } finally {
        setIsSaving(false);
      }
    } else {
      showToast('Por favor, insira um link válido para o PDF.', 'error');
    }
  };

  const handleAudioChange = (e: ChangeEvent<HTMLInputElement> | File) => {
    if (!isAdmin) {
      showToast('Apenas o administrador pode alterar o áudio.', 'error');
      return;
    }
    const file = e instanceof File ? e : e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setIsPlaying(false);
      showToast('Áudio carregado com sucesso!');
    } else if (file) {
      showToast('Por favor, selecione um arquivo de áudio válido.', 'error');
    }
  };

  const togglePlayback = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => Math.min(Math.max(1, prevPageNumber + offset), numPages || 1));
  };

  const handleSoundcloudSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    
    if (tempSoundcloudUrl.includes('soundcloud.com')) {
      setSoundcloudUrl(tempSoundcloudUrl);
      setAudioUrl(null); // Clear local audio if switching to soundcloud
      showToast('Link do SoundCloud adicionado!');
    } else {
      showToast('Por favor, insira um link válido do SoundCloud.', 'error');
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-500 flex flex-col items-center relative ${
      darkMode ? 'bg-[#0f172a]' : 'bg-slate-50'
    }`}>
      {/* Header */}
      <header className={`w-full px-8 py-4 flex justify-end items-center z-40 transition-colors ${
        darkMode ? 'bg-[#0f172a] text-white' : 'bg-white text-slate-800 border-b border-slate-200'
      }`}>
        <div className="flex items-center gap-6">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border ${
              darkMode 
                ? 'bg-[#1e293b] border-white/10 text-[#A0C6ED] hover:bg-[#274566]' 
                : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
          
          {user ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} className="w-6 h-6 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon className="w-4 h-4" />
                )}
                <span className="text-xs font-bold tracking-wider truncate max-w-[100px]">{user.displayName || user.email}</span>
              </div>
              <button onClick={handleLogout} className="flex items-center gap-2 cursor-pointer group hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
                <span className="text-xs font-bold tracking-[0.2em] uppercase">Sair</span>
              </button>
            </div>
          ) : (
            <button onClick={handleLogin} className="flex items-center gap-2 cursor-pointer group hover:text-[#A0C6ED] transition-colors">
              <LogIn className="w-4 h-4" />
              <span className="text-xs font-bold tracking-[0.2em] uppercase">Login</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full flex items-center justify-center p-8 md:p-12">
        <div className="max-w-7xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start relative">
          {/* Red circle area indicator from user image (optional, but shows we understood the position) */}
          <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full border-2 border-red-500/0 pointer-events-none" />

          {/* Left Column: Episode Card (Podcast) */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className={`lg:col-span-5 rounded-3xl p-8 shadow-2xl border transition-colors duration-500 flex flex-col gap-6 ${
            darkMode ? 'bg-[#1e293b] border-white/5' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex justify-between items-start">
            <div className={`p-3 rounded-xl border transition-colors ${
              darkMode ? 'bg-[#274566]/30 border-[#A0C6ED]/20' : 'bg-slate-100 border-slate-200'
            }`}>
              <BarChart2 className={`w-6 h-6 ${darkMode ? 'text-[#A0C6ED]' : 'text-slate-600'}`} />
            </div>
            <span className={`font-bold tracking-wider text-sm ${darkMode ? 'text-[#A0C6ED]' : 'text-slate-400'}`}>EP 1</span>
          </div>

          <div className="space-y-2">
            {isAdmin ? (
              <div className="space-y-2">
                <input 
                  type="text"
                  value={episodeTitle}
                  onChange={(e) => setEpisodeTitle(e.target.value)}
                  className={`w-full bg-transparent text-2xl font-bold tracking-tight outline-none border-b border-transparent focus:border-[#A0C6ED]/30 transition-all ${darkMode ? 'text-white' : 'text-slate-900'}`}
                  placeholder="Título do Episódio"
                />
                <textarea 
                  value={episodeDescription}
                  onChange={(e) => setEpisodeDescription(e.target.value)}
                  rows={3}
                  className={`w-full bg-transparent text-sm leading-relaxed outline-none border-b border-transparent focus:border-[#A0C6ED]/30 transition-all resize-none ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}
                  placeholder="Descrição do Episódio"
                />
                <button 
                  onClick={handleSaveEpisode}
                  disabled={isSaving}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    darkMode ? 'bg-[#A0C6ED]/10 text-[#A0C6ED] hover:bg-[#A0C6ED]/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : ''}`} />
                  {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
              </div>
            ) : (
              <>
                <h1 className={`text-2xl font-bold tracking-tight transition-colors ${darkMode ? 'text-white' : 'text-slate-900'}`}>
                  {episodeTitle}
                </h1>
                <p className={`text-sm leading-relaxed transition-colors ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                  {episodeDescription}
                </p>
              </>
            )}
          </div>

          {/* Podcast Upload / Player */}
          <div className="space-y-4">
            {isAdmin && (
              <div className="flex gap-2 p-1 rounded-xl border transition-colors bg-black/5 border-white/5">
                <button 
                  onClick={() => setAudioMode('file')}
                  className={`flex-1 py-2 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                    audioMode === 'file' 
                      ? (darkMode ? 'bg-[#A0C6ED] text-[#0f172a]' : 'bg-slate-800 text-white') 
                      : (darkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800')
                  }`}
                >
                  <Upload className="w-3 h-3" />
                  Arquivo
                </button>
                <button 
                  onClick={() => setAudioMode('soundcloud')}
                  className={`flex-1 py-2 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                    audioMode === 'soundcloud' 
                      ? (darkMode ? 'bg-[#A0C6ED] text-[#0f172a]' : 'bg-slate-800 text-white') 
                      : (darkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800')
                  }`}
                >
                  <Music className="w-3 h-3" />
                  SoundCloud
                </button>
              </div>
            )}

            {audioMode === 'soundcloud' ? (
              <div className={`relative aspect-video rounded-2xl overflow-hidden border transition-all duration-300 flex flex-col items-center justify-center gap-3 p-4 text-center ${
                darkMode ? 'bg-[#0f172a] border-white/10' : 'bg-slate-50 border-slate-200'
              }`}>
                {soundcloudUrl ? (
                  <div className="absolute inset-0 z-10">
                    <iframe 
                      width="100%" 
                      height="100%" 
                      scrolling="no" 
                      frameBorder="no" 
                      allow="autoplay" 
                      src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(soundcloudUrl)}&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true`}
                    />
                    {isAdmin && (
                      <button 
                        onClick={() => setSoundcloudUrl(null)}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-red-500 transition-colors z-20"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="z-10 w-full px-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-sm border mx-auto mb-4 ${
                      darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm'
                    }`}>
                      <Music className="text-slate-500 w-6 h-6" />
                    </div>
                    {isAdmin ? (
                      <form onSubmit={handleSoundcloudSubmit} className="space-y-3">
                        <div className="relative">
                          <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                          <input 
                            type="text"
                            value={tempSoundcloudUrl}
                            onChange={(e) => setTempSoundcloudUrl(e.target.value)}
                            placeholder="Link do SoundCloud..."
                            className={`w-full pl-9 pr-4 py-2.5 rounded-xl text-xs border transition-all outline-none ${
                              darkMode 
                                ? 'bg-[#1e293b] border-white/10 text-white focus:border-[#A0C6ED]/50' 
                                : 'bg-white border-slate-200 text-slate-800 focus:border-slate-400'
                            }`}
                          />
                        </div>
                        <button 
                          type="submit"
                          className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all ${
                            darkMode ? 'bg-[#A0C6ED] text-[#0f172a] hover:bg-[#8eb2d6]' : 'bg-slate-800 text-white hover:bg-slate-900'
                          }`}
                        >
                          Adicionar Link
                        </button>
                      </form>
                    ) : (
                      <p className="text-slate-500 text-xs">Aguarde o administrador adicionar o link do SoundCloud</p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div 
                onClick={() => isAdmin && !audioUrl && audioInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); isAdmin && setIsDraggingAudio(true); }}
                onDragLeave={() => setIsDraggingAudio(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingAudio(false);
                  if (isAdmin) {
                    const file = e.dataTransfer.files[0];
                    handleAudioChange(file);
                  } else {
                    showToast('Apenas o administrador pode alterar o áudio.', 'error');
                  }
                }}
                className={`relative aspect-video rounded-2xl overflow-hidden border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-3 p-4 text-center ${
                  audioUrl ? (darkMode ? 'border-[#A0C6ED]/30' : 'border-slate-300') : 
                  isDraggingAudio ? (darkMode ? 'border-[#A0C6ED] bg-[#A0C6ED]/5 scale-[1.02]' : 'border-slate-400 bg-slate-50 scale-[1.02]') :
                  (darkMode ? `bg-[#0f172a] border-white/10 ${isAdmin ? 'cursor-pointer hover:border-[#A0C6ED]/50 hover:bg-white/5' : ''}` : `bg-slate-50 border-slate-200 ${isAdmin ? 'cursor-pointer hover:border-slate-300 hover:bg-slate-100' : ''}`)
                }`}
              >
                {isAdmin && (
                  <input 
                    type="file" 
                    ref={audioInputRef} 
                    onChange={handleAudioChange} 
                    accept="audio/*" 
                    className="hidden" 
                  />
                )}
                
                <div className={`absolute inset-0 ${darkMode ? 'bg-gradient-to-br from-[#274566]/20 via-transparent to-black/20' : 'bg-gradient-to-br from-slate-200/20 via-transparent to-slate-300/10'}`} />
                
                {audioUrl ? (
                  <div className="z-10 w-full space-y-4">
                    <div className="flex items-center justify-center gap-4">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center border transition-colors ${
                        darkMode ? 'bg-[#A0C6ED]/10 border-[#A0C6ED]/20' : 'bg-white border-slate-200 shadow-sm'
                      }`}>
                        <Mic className={`w-6 h-6 ${darkMode ? 'text-[#A0C6ED]' : 'text-slate-500'}`} />
                      </div>
                      <div className={`flex-1 h-1 rounded-full overflow-hidden transition-colors ${darkMode ? 'bg-white/10' : 'bg-slate-200'}`}>
                        <motion.div 
                          animate={{ x: isPlaying ? [0, 100, 0] : 0 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          className={`w-1/3 h-full ${darkMode ? 'bg-[#A0C6ED]' : 'bg-slate-400'}`}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); togglePlayback(); }}
                        className={`w-12 h-12 rounded-full flex items-center justify-center hover:scale-105 transition-all shadow-lg ${
                          darkMode ? 'bg-[#A0C6ED] text-[#0f172a]' : 'bg-slate-800 text-white'
                        }`}
                      >
                        {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                      </button>
                      <p className={`text-xs font-medium transition-colors ${darkMode ? 'text-white' : 'text-slate-700'}`}>Podcast Carregado</p>
                      {isAdmin && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); audioInputRef.current?.click(); }}
                          className={`text-[10px] uppercase tracking-wider hover:underline transition-colors ${darkMode ? 'text-[#A0C6ED]' : 'text-slate-500'}`}
                        >
                          Trocar Áudio
                        </button>
                      )}
                    </div>
                    <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} className="hidden" />
                  </div>
                ) : (
                  <div className="z-10">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center backdrop-blur-sm border transition-all mb-2 ${
                      darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm'
                    }`}>
                      <Mic className="text-slate-500 w-8 h-8" />
                    </div>
                    <p className={`font-medium text-sm transition-colors ${darkMode ? 'text-slate-300' : 'text-slate-600'}`}>
                      {isAdmin ? 'Inserir Podcast' : 'Podcast não disponível'}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {isAdmin ? 'Clique para selecionar o áudio' : 'Aguarde o administrador carregar o áudio'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              darkMode ? 'bg-[#0f172a] text-slate-400 border-white/5' : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              Planejamento Logístico
            </span>
            <span className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              darkMode ? 'bg-[#0f172a] text-slate-400 border-white/5' : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              Introdução
            </span>
          </div>

          <button 
            disabled={!pdfUrl}
            onClick={() => setShowViewer(true)}
            className={`mt-2 w-full font-semibold py-4 px-6 rounded-full flex items-center justify-center gap-2 transition-all duration-200 shadow-lg ${
              pdfUrl 
                ? (darkMode ? 'bg-[#274566] hover:bg-[#335a85] text-white shadow-[#274566]/20 active:scale-[0.98]' : 'bg-slate-800 hover:bg-slate-900 text-white active:scale-[0.98]')
                : (darkMode ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-slate-200 text-slate-400 cursor-not-allowed')
            }`}
          >
            <Eye className="w-5 h-5" />
            Visualizar Arquivo
          </button>
        </motion.div>

        {/* Right Column: PDF Attachment Area */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className={`lg:col-span-7 rounded-3xl overflow-hidden shadow-2xl border transition-colors duration-500 min-h-[600px] flex flex-col p-8 relative ${
            darkMode ? 'bg-[#1e293b] border-white/5' : 'bg-white border-slate-200'
          }`}
        >
          {isAdmin && (
            <div className="flex gap-2 p-1 rounded-xl border transition-colors bg-black/5 border-white/5 mb-6 w-fit mx-auto">
              <button 
                onClick={() => setPdfMode('file')}
                className={`py-1.5 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                  pdfMode === 'file' 
                    ? (darkMode ? 'bg-[#A0C6ED] text-[#0f172a]' : 'bg-slate-800 text-white') 
                    : (darkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800')
                }`}
              >
                <Upload className="w-3 h-3" />
                Arquivo
              </button>
              <button 
                onClick={() => setPdfMode('link')}
                className={`py-1.5 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                  pdfMode === 'link' 
                    ? (darkMode ? 'bg-[#A0C6ED] text-[#0f172a]' : 'bg-slate-800 text-white') 
                    : (darkMode ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800')
                }`}
              >
                <LinkIcon className="w-3 h-3" />
                Link PDF
              </button>
            </div>
          )}

          {isAdmin && (
            <input 
              type="file" 
              ref={pdfInputRef} 
              onChange={handlePdfChange} 
              accept="application/pdf" 
              className="hidden" 
            />
          )}

          {!pdfUrl || (isAdmin && pdfMode === 'link' && !tempPdfUrl) ? (
            <div className="flex-1 w-full flex flex-col items-center justify-center">
              {isAdmin && pdfMode === 'link' ? (
                <div className="w-full max-w-md space-y-4 text-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center backdrop-blur-sm border mx-auto mb-4 ${
                    darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200 shadow-sm'
                  }`}>
                    <LinkIcon className="text-slate-500 w-8 h-8" />
                  </div>
                  <h3 className={`font-semibold text-xl transition-colors ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                    Link do Material de Apoio
                  </h3>
                  <form onSubmit={handlePdfUrlSubmit} className="space-y-3">
                    <input 
                      type="text"
                      value={tempPdfUrl}
                      onChange={(e) => setTempPdfUrl(e.target.value)}
                      placeholder="Cole o link do PDF aqui (ex: Google Drive, Dropbox...)"
                      className={`w-full px-4 py-3 rounded-xl text-sm border transition-all outline-none ${
                        darkMode 
                          ? 'bg-[#0f172a] border-white/10 text-white focus:border-[#A0C6ED]/50' 
                          : 'bg-slate-50 border-slate-200 text-slate-800 focus:border-slate-400'
                      }`}
                    />
                    <button 
                      type="submit"
                      disabled={isSaving}
                      className={`w-full py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                        darkMode ? 'bg-[#A0C6ED] text-[#0f172a] hover:bg-[#8eb2d6]' : 'bg-slate-800 text-white hover:bg-slate-900'
                      }`}
                    >
                      {isSaving ? <Save className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Fixar Link do PDF Permanentemente
                    </button>
                  </form>
                  <p className="text-slate-500 text-xs mt-4">
                    Dica: Use links do Google Drive (compartilhado publicamente), Dropbox ou OneDrive para que o PDF fique disponível para todos os usuários.
                  </p>
                </div>
              ) : (
                <div 
                  onClick={() => isAdmin && pdfInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); isAdmin && setIsDraggingPdf(true); }}
                  onDragLeave={() => setIsDraggingPdf(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingPdf(false);
                    if (isAdmin) {
                      const file = e.dataTransfer.files[0];
                      handlePdfChange(file);
                    } else {
                      showToast('Apenas o administrador pode alterar o PDF.', 'error');
                    }
                  }}
                  className={`w-full h-full border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-6 transition-all group ${
                    isAdmin ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isDraggingPdf 
                      ? (darkMode ? 'border-[#A0C6ED] bg-[#A0C6ED]/5 scale-[1.01]' : 'border-slate-400 bg-slate-50 scale-[1.01]')
                      : (darkMode ? `border-white/10 ${isAdmin ? 'hover:border-[#A0C6ED]/30 hover:bg-white/5' : ''}` : `border-slate-200 ${isAdmin ? 'hover:border-slate-300 hover:bg-slate-50' : ''}`)
                  }`}
                >
                  <div className={`w-20 h-20 rounded-2xl border flex items-center justify-center transition-all ${
                    darkMode ? 'bg-[#0f172a] border-white/5' : 'bg-slate-50 border-slate-200'
                  } ${
                    isDraggingPdf ? (darkMode ? 'scale-110 border-[#A0C6ED]/30' : 'scale-110 border-slate-400') : (isAdmin ? 'group-hover:scale-110' : '')
                  }`}>
                    <Upload className={`w-10 h-10 transition-colors ${
                      isDraggingPdf ? (darkMode ? 'text-[#A0C6ED]' : 'text-slate-600') : (darkMode ? 'text-slate-500 group-hover:text-[#A0C6ED]' : 'text-slate-400 group-hover:text-slate-600')
                    }`} />
                  </div>
                  <div className="text-center space-y-2 px-4">
                    <h3 className={`font-semibold text-xl transition-colors ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                      {isDraggingPdf ? 'Solte para Anexar' : (isAdmin ? 'Anexar Documento PDF' : 'Documento não disponível')}
                    </h3>
                    <p className="text-slate-500 text-sm max-w-xs mx-auto">
                      {isDraggingPdf ? 'O arquivo será carregado instantaneamente' : (isAdmin ? 'Arraste e solte ou clique para selecionar o material de apoio.' : 'Aguarde o administrador carregar o material de apoio.')}
                    </p>
                  </div>
                  {isAdmin && !isDraggingPdf && (
                    <button className={`px-8 py-3 rounded-full text-sm font-bold transition-all shadow-lg active:scale-95 ${
                      darkMode ? 'bg-[#274566] text-[#A0C6ED] hover:bg-[#335a85] shadow-black/20' : 'bg-slate-800 text-white hover:bg-slate-900 shadow-slate-200'
                    }`}>
                      Selecionar Arquivo
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-full flex flex-col p-0">
               <div className={`flex-1 rounded-3xl overflow-hidden shadow-inner relative flex flex-col items-center transition-colors ${
                 darkMode ? 'bg-slate-900' : 'bg-slate-100'
               }`}>
                 {/* Floating Controls */}
                 {isAdmin && (
                   <div className="absolute top-6 right-6 z-20 flex gap-2">
                      <div className="relative group/tooltip">
                        <button 
                          onClick={() => pdfInputRef.current?.click()}
                          className={`p-3 backdrop-blur-md rounded-full border shadow-xl transition-all hover:scale-110 active:scale-95 ${
                            darkMode ? 'bg-[#1e293b]/80 text-slate-300 border-white/10 hover:bg-[#A0C6ED] hover:text-[#0f172a]' : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                        <span className={`absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] rounded opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-all group-hover/tooltip:translate-x-0 translate-x-2 whitespace-nowrap border ${
                          darkMode ? 'bg-slate-800 text-white border-white/5' : 'bg-white text-slate-800 border-slate-200 shadow-sm'
                        }`}>
                          Substituir PDF
                        </span>
                      </div>
                      <div className="relative group/tooltip">
                        <button 
                          onClick={() => { setPdfUrl(null); showToast('PDF removido'); }}
                          className={`p-3 backdrop-blur-md rounded-full border shadow-xl transition-all hover:scale-110 active:scale-95 ${
                            darkMode ? 'bg-[#1e293b]/80 text-slate-300 border-white/10 hover:bg-red-500/20 hover:text-red-400' : 'bg-white/80 text-slate-600 border-slate-200 hover:bg-red-50 hover:text-red-500'
                          }`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <span className={`absolute right-full mr-3 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] rounded opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-all group-hover/tooltip:translate-x-0 translate-x-2 whitespace-nowrap border ${
                          darkMode ? 'bg-slate-800 text-white border-white/5' : 'bg-white text-slate-800 border-slate-200 shadow-sm'
                        }`}>
                          Remover PDF
                        </span>
                      </div>
                   </div>
                 )}

                 <div className={`flex-1 w-full overflow-auto custom-scrollbar flex justify-center p-4 transition-colors ${darkMode ? 'bg-[#0f172a]' : 'bg-slate-200'}`}>
                   <Document
                     file={pdfFile}
                     onLoadSuccess={onDocumentLoadSuccess}
                     onLoadError={(error) => {
                       console.error('PDF Load Error (Main):', error);
                       if (error.message?.includes('415')) {
                         showToast('O link não é um PDF direto. Use um link público.', 'error');
                       } else {
                         showToast('Erro ao carregar PDF. Verifique o link.', 'error');
                       }
                     }}
                     loading={
                       <div className="flex flex-col items-center justify-center h-full space-y-4">
                         <div className={`w-8 h-8 border-4 border-t-transparent rounded-full animate-spin ${darkMode ? 'border-[#A0C6ED]' : 'border-slate-600'}`} />
                         <p className="text-slate-400 text-xs">Carregando PDF...</p>
                       </div>
                     }
                     error={
                       <div className="flex flex-col items-center justify-center h-full p-8 text-center space-y-4">
                         <FileText className="w-12 h-12 text-red-400 opacity-50" />
                         <p className={`font-medium transition-colors ${darkMode ? 'text-white' : 'text-slate-800'}`}>Erro ao carregar PDF</p>
                         <button 
                           onClick={() => window.open(pdfUrl || '', '_blank')}
                           className={`px-4 py-2 rounded-lg text-xs transition-colors ${darkMode ? 'bg-white/5 text-slate-300 hover:bg-white/10' : 'bg-slate-300 text-slate-700 hover:bg-slate-400'}`}
                         >
                           Abrir em Nova Aba
                         </button>
                       </div>
                     }
                   >
                     <Page 
                       pageNumber={pageNumber} 
                       width={500}
                       renderAnnotationLayer={false}
                       renderTextLayer={false}
                       className="shadow-2xl"
                     />
                   </Document>
                 </div>

                 {/* PDF Navigation Controls */}
                 {numPages && numPages > 1 && (
                   <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 backdrop-blur-md px-4 py-2 rounded-full border shadow-2xl z-10 transition-colors ${
                     darkMode ? 'bg-[#1e293b]/90 border-white/10' : 'bg-white/90 border-slate-200'
                   }`}>
                     <button 
                       onClick={() => changePage(-1)}
                       disabled={pageNumber <= 1}
                       className={`p-1 rounded-full disabled:opacity-30 transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                     >
                       <ChevronLeft className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-slate-800'}`} />
                     </button>
                     <span className={`text-xs font-mono transition-colors ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                       {pageNumber} <span className="text-slate-500">/</span> {numPages}
                     </span>
                     <button 
                       onClick={() => changePage(1)}
                       disabled={pageNumber >= numPages}
                       className={`p-1 rounded-full disabled:opacity-30 transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-200'}`}
                     >
                       <ChevronRight className={`w-5 h-5 ${darkMode ? 'text-white' : 'text-slate-800'}`} />
                     </button>
                   </div>
                 )}
               </div>
            </div>
          )}
        </motion.div>
      </div>
    </main>


      {/* PDF Viewer Modal */}
      <AnimatePresence>
        {showViewer && pdfUrl && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col"
          >
            <div className={`p-4 flex justify-between items-center border-b transition-colors ${darkMode ? 'bg-[#0f172a] border-white/10' : 'bg-white border-slate-200'}`}>
              <div className="flex items-center gap-3">
                <FileText className={`w-6 h-6 ${darkMode ? 'text-[#A0C6ED]' : 'text-slate-600'}`} />
                <span className={`font-medium ${darkMode ? 'text-white' : 'text-slate-800'}`}>Visualização do Documento</span>
              </div>
              <button 
                onClick={() => setShowViewer(false)}
                className={`p-2 rounded-full transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-slate-100'}`}
              >
                <X className={`w-6 h-6 ${darkMode ? 'text-white' : 'text-slate-800'}`} />
              </button>
            </div>
            <div className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 overflow-auto custom-scrollbar flex justify-center">
              <Document
                file={pdfFile}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={(error) => {
                  console.error('PDF Load Error (Modal):', error);
                  const errorMsg = error.message || '';
                  if (errorMsg.includes('415')) {
                    showToast('O link não é um PDF direto. Use um link de download direto.', 'error');
                  } else if (errorMsg.includes('403')) {
                    showToast('Acesso negado. Certifique-se de que o PDF está compartilhado publicamente.', 'error');
                  } else if (errorMsg.includes('404')) {
                    showToast('Arquivo não encontrado. Verifique o link.', 'error');
                  } else {
                    showToast('Erro ao carregar PDF. Tente abrir o link original.', 'error');
                  }
                }}
                error={
                  <div className="flex flex-col items-center justify-center h-full p-12 text-center space-y-6">
                    <FileText className="w-16 h-16 text-red-400 opacity-50" />
                    <div className="space-y-2">
                      <p className={`text-lg font-semibold transition-colors ${darkMode ? 'text-white' : 'text-slate-800'}`}>
                        Não foi possível carregar o PDF no visualizador
                      </p>
                      <p className="text-slate-500 text-sm max-w-md mx-auto">
                        Isso pode acontecer devido a restrições de segurança do site de origem ou se o link não for um PDF direto.
                      </p>
                    </div>
                    <button 
                      onClick={() => window.open(tempPdfUrl || pdfUrl || '', '_blank')}
                      className={`px-8 py-3 rounded-full font-bold transition-all active:scale-95 shadow-lg ${
                        darkMode ? 'bg-[#A0C6ED] text-[#0f172a] hover:bg-[#8eb2d6]' : 'bg-slate-800 text-white hover:bg-slate-900'
                      }`}
                    >
                      Visualizar no Link Original
                    </button>
                  </div>
                }
                className="shadow-2xl"
              >
                {Array.from(new Array(numPages), (_, index) => (
                  <div key={`page_${index + 1}`} className="mb-8">
                    <Page 
                      pageNumber={index + 1} 
                      width={800}
                      renderAnnotationLayer={false}
                      renderTextLayer={false}
                    />
                  </div>
                ))}
              </Document>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Feedback */}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className={`fixed bottom-8 left-1/2 z-[100] px-6 py-3 rounded-full shadow-2xl border flex items-center gap-3 backdrop-blur-md ${
              toast.type === 'success' 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span className="text-sm font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
