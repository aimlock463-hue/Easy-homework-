import React, { useState, useRef, useEffect } from 'react';
import { 
  Camera, 
  MessageSquare, 
  BookOpen, 
  Send, 
  Image as ImageIcon, 
  X, 
  ChevronLeft, 
  History, 
  Sparkles,
  GraduationCap,
  BrainCircuit,
  PenTool,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';
import { 
  auth, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  db, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  handleFirestoreError, 
  OperationType,
  User,
  getDocs,
  deleteDoc
} from './firebase';

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error.message);
        if (parsedError.error) {
          errorMessage = `Firestore Error: ${parsedError.error} during ${parsedError.operationType} on ${parsedError.path}`;
        }
      } catch (e) {
        errorMessage = this.state.error.message || String(this.state.error);
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-950 p-6 text-center">
          <div className="p-6 bg-rose-500/10 border border-rose-500/20 rounded-[2rem] max-w-sm">
            <h2 className="text-xl font-bold text-rose-500 mb-2 font-display">Oops!</h2>
            <p className="text-slate-400 text-sm mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-rose-500 text-white rounded-xl font-bold text-sm active:scale-95 transition-transform"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface Message {
  role: 'user' | 'model';
  text: string;
  image?: string;
  subject?: string;
}

export default function App() {
  const [view, setView] = useState<'home' | 'scan' | 'chat' | 'essay'>('home');
  const [subject, setSubject] = useState('General');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        try {
          const userDoc = await getDoc(userRef);
          if (!userDoc.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isAuthReady) return;

    const messagesRef = collection(db, 'users', user.uid, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const history = snapshot.docs.map(doc => ({
        role: doc.data().role,
        text: doc.data().text,
        image: doc.data().image,
        subject: doc.data().subject
      } as Message));
      setMessages(history);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/messages`);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setView('home');
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setView('scan');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async (text: string, image?: string) => {
    if (!text.trim() && !image) return;
    if (!user) return;

    const userMessage: Message = { role: 'user', text, image, subject };
    
    setInput('');
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const messagesRef = collection(db, 'users', user.uid, 'messages');
      
      // Clean up message data to avoid undefined fields which Firestore doesn't support
      const messageData: any = {
        role: userMessage.role,
        text: userMessage.text,
        userId: user.uid,
        subject: userMessage.subject,
        timestamp: serverTimestamp()
      };
      if (userMessage.image) {
        messageData.image = userMessage.image;
      }

      await addDoc(messagesRef, messageData);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      
      let prompt = text;
      if (view === 'essay') {
        prompt = `As an expert essay writer, help me with: ${text}. Provide structure, arguments, and refined language.`;
      } else if (view === 'scan') {
        prompt = `Solve this homework problem from the image. Provide a step-by-step explanation. ${text}`;
      } else {
        prompt = `You are an expert ${subject} tutor. Help the student with their homework. Be encouraging and provide step-by-step explanations. If an image is provided, analyze it carefully. ${text}`;
      }

      const contents: any = { parts: [] };
      if (image) {
        contents.parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: image.split(',')[1]
          }
        });
      }
      contents.parts.push({ text: prompt });

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [contents]
      });

      const responseText = result.text || "I'm sorry, I couldn't process that.";
      
      await addDoc(messagesRef, {
        role: 'model',
        text: responseText,
        userId: user.uid,
        subject,
        timestamp: serverTimestamp()
      });

    } catch (error) {
      console.error("Error sending message:", error);
      if (error instanceof Error && error.message.includes('permission')) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/messages`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const renderLogin = () => (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-950">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-indigo-500 blur-3xl opacity-20 rounded-full" />
        <div className="relative p-10 bg-slate-900 rounded-[3rem] shadow-2xl shadow-indigo-950/50 border border-slate-800">
          <GraduationCap className="w-16 h-16 text-indigo-500" />
        </div>
      </div>
      <h1 className="text-3xl font-display font-bold text-white mb-2 tracking-tight">Easy Homework</h1>
      <p className="text-slate-400 text-sm mb-12 max-w-[240px] leading-relaxed font-medium">
        Sign in to save your progress and chat with your AI study companion.
      </p>
      <button 
        onClick={handleLogin}
        className="w-full flex items-center justify-center gap-3 p-4 bg-white text-slate-900 rounded-2xl font-bold text-base hover:bg-slate-100 transition-all active:scale-95 shadow-xl shadow-white/5"
      >
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
        Continue with Google
      </button>
      <p className="mt-8 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
        Securely powered by Firebase
      </p>
    </div>
  );

  const renderHome = () => (
    <div className="flex flex-col gap-8 p-6 pb-32 h-full overflow-y-auto scrollbar-hide">
      <header className="flex flex-col gap-1 mt-6 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-900/20">
              <GraduationCap className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl font-display font-bold text-white tracking-tight">Easy Homework</h1>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2.5 bg-slate-900 rounded-2xl border border-slate-800 shadow-sm active:scale-90 transition-transform group"
            title="Logout"
          >
            <LogOut className="w-5 h-5 text-slate-400 group-hover:text-rose-400 transition-colors" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-slate-400 text-sm font-medium">Welcome back, {user?.displayName?.split(' ')[0]}</p>
          <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 overflow-hidden shadow-lg shadow-indigo-950/50">
            <img src={user?.photoURL || ''} alt="Profile" className="w-full h-full object-cover" />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 shrink-0">
        <button 
          onClick={() => { setView('scan'); }}
          className="relative overflow-hidden flex items-center gap-4 p-5 bg-slate-900 border border-slate-800 rounded-[2rem] shadow-none hover:bg-slate-800/50 transition-all group active:scale-[0.98]"
        >
          <div className="p-4 bg-indigo-600 rounded-2xl group-hover:scale-110 transition-transform shadow-lg shadow-indigo-900/20">
            <Camera className="text-white w-7 h-7" />
          </div>
          <div className="text-left">
            <span className="block font-bold text-white text-lg font-display">Scan & Solve</span>
            <span className="text-slate-400 text-sm">Instant step-by-step solutions</span>
          </div>
          <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Camera className="w-24 h-24 text-white" />
          </div>
        </button>

        <div className="grid grid-cols-2 gap-4">
          <button 
            onClick={() => { setView('chat'); }}
            className="flex flex-col items-start gap-4 p-5 bg-slate-900 border border-slate-800 rounded-[2rem] shadow-none hover:bg-slate-800/50 transition-all group active:scale-[0.98]"
          >
            <div className="p-3 bg-emerald-600 rounded-xl group-hover:scale-110 transition-transform shadow-lg shadow-emerald-900/20">
              <MessageSquare className="text-white w-5 h-5" />
            </div>
            <div className="text-left">
              <span className="block font-bold text-white font-display">AI Tutor</span>
              <span className="text-slate-400 text-xs">Chat with AI</span>
            </div>
          </button>

          <button 
            onClick={() => { setView('essay'); }}
            className="flex flex-col items-start gap-4 p-5 bg-slate-900 border border-slate-800 rounded-[2rem] shadow-none hover:bg-slate-800/50 transition-all group active:scale-[0.98]"
          >
            <div className="p-3 bg-amber-600 rounded-xl group-hover:scale-110 transition-transform shadow-lg shadow-amber-900/20">
              <PenTool className="text-white w-5 h-5" />
            </div>
            <div className="text-left">
              <span className="block font-bold text-white font-display">Essay Helper</span>
              <span className="text-slate-400 text-xs">Write better</span>
            </div>
          </button>
        </div>
      </div>

      <div className="shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2 font-display">
            <BrainCircuit className="w-4 h-4 text-indigo-400" />
            Select Subject
          </h2>
          <span className="text-xs font-bold text-indigo-400 bg-indigo-950/50 px-2 py-1 rounded-lg uppercase tracking-wider">Active: {subject}</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-2 px-2">
          {['General', 'Math', 'Physics', 'Biology', 'History', 'Literature'].map(s => (
            <button
              key={s}
              onClick={() => setSubject(s)}
              className={cn(
                "px-5 py-2.5 rounded-2xl text-sm font-semibold transition-all shrink-0 active:scale-95",
                subject === s 
                  ? "bg-indigo-600 text-white shadow-xl shadow-indigo-900/40" 
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:border-indigo-500 hover:text-indigo-400"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderChat = () => (
    <div className="flex flex-col h-full bg-slate-950">
      <header className="flex items-center justify-between p-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setView('home')}
            className="p-2.5 hover:bg-slate-800 rounded-2xl transition-colors active:scale-90 border border-transparent hover:border-slate-700"
          >
            <ChevronLeft className="w-5 h-5 text-slate-300" />
          </button>
          <div>
            <h2 className="font-bold text-white capitalize font-display tracking-tight">{view} Mode</h2>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {subject} AI Tutor
              </p>
            </div>
          </div>
        </div>
        <button 
          onClick={async () => {
            if (!user) return;
            try {
              const messagesRef = collection(db, 'users', user.uid, 'messages');
              const q = query(messagesRef);
              const snapshot = await getDocs(q);
              const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
              await Promise.all(deletePromises);
            } catch (error) {
              console.error("Error clearing chat:", error);
              handleFirestoreError(error, OperationType.DELETE, `users/${user.uid}/messages`);
            }
          }}
          className="p-2.5 hover:bg-slate-800 rounded-2xl transition-colors active:scale-90 border border-transparent hover:border-slate-700"
          title="Clear Chat"
        >
          <History className="w-5 h-5 text-slate-500" />
        </button>
      </header>

      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-hide"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-6 py-12">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 rounded-full" />
              <div className="relative p-8 bg-slate-900 rounded-[2.5rem] shadow-2xl shadow-indigo-950/50 border border-slate-800">
                <Sparkles className="w-12 h-12 text-indigo-400" />
              </div>
            </div>
            <div className="max-w-[200px] space-y-2">
              <p className="font-bold text-white font-display text-lg">
                Ready to help!
              </p>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">
                Ask me anything about your homework or scan a problem.
              </p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className={cn(
                "flex flex-col max-w-[88%]",
                msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              {msg.image && (
                <div className="relative group mb-2">
                  <img 
                    src={msg.image} 
                    alt="Homework" 
                    className="rounded-3xl max-w-full border-4 border-slate-800 shadow-xl"
                  />
                  <div className="absolute inset-0 rounded-3xl bg-black/20 group-hover:bg-transparent transition-colors" />
                </div>
              )}
              <div className={cn(
                "p-4 rounded-[1.5rem] text-sm leading-relaxed shadow-sm transition-all",
                msg.role === 'user' 
                  ? "bg-indigo-600 text-white rounded-tr-none shadow-lg shadow-indigo-950/50" 
                  : "bg-slate-900 text-slate-100 rounded-tl-none border border-slate-800 shadow-md"
              )}>
                <div className={cn(
                  "prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-950 prose-pre:text-white prose-code:text-indigo-400 prose-invert",
                )}>
                  <Markdown>
                    {msg.text}
                  </Markdown>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        
        {isLoading && (
          <div className="flex items-center gap-3 text-slate-500 text-xs font-bold uppercase tracking-widest pl-2">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Thinking...
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-900 border-t border-slate-800">
        <AnimatePresence>
          {selectedImage && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 10 }}
              className="relative inline-block mb-4"
            >
              <img src={selectedImage} alt="Selected" className="w-24 h-24 object-cover rounded-2xl border-4 border-slate-800 shadow-xl" />
              <button 
                onClick={() => setSelectedImage(null)}
                className="absolute -top-2 -right-2 p-1.5 bg-rose-600 text-white rounded-full shadow-lg active:scale-90 transition-transform"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-4 bg-slate-800 hover:bg-slate-700 rounded-[1.25rem] text-slate-400 transition-colors active:scale-90 border border-slate-700"
          >
            <ImageIcon className="w-6 h-6" />
          </button>
          <div className="flex-1 relative group">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend(input, selectedImage || undefined)}
              placeholder={view === 'scan' ? "Describe the problem..." : "Ask your AI tutor..."}
              className="w-full p-4 pr-14 bg-slate-800 border border-slate-700 rounded-[1.25rem] text-white placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500/20 focus:bg-slate-800 focus:border-indigo-500 transition-all outline-none font-medium"
            />
            <button 
              onClick={() => handleSend(input, selectedImage || undefined)}
              disabled={isLoading || (!input.trim() && !selectedImage)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 disabled:bg-slate-700 text-white rounded-xl transition-all shadow-lg shadow-indigo-900/40 active:scale-90"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="max-w-md mx-auto h-screen bg-slate-950 shadow-2xl flex flex-col overflow-hidden font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
        {!isAuthReady ? (
          <div className="flex items-center justify-center h-full bg-slate-950">
            <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
          </div>
        ) : !user ? (
          renderLogin()
        ) : (
          <>
            <main className="flex-1 overflow-hidden relative">
              {view === 'home' ? renderHome() : renderChat()}
            </main>

            <nav className="flex items-center justify-around p-4 bg-slate-900/80 backdrop-blur-xl border-t border-slate-800 sticky bottom-0 shrink-0 z-30">
              <button 
                onClick={() => setView('home')}
                className={cn(
                  "flex flex-col items-center gap-1 transition-all active:scale-90 flex-1",
                  view === 'home' ? "text-indigo-400" : "text-slate-500 hover:text-indigo-400"
                )}
              >
                <BookOpen className={cn("w-6 h-6 transition-transform", view === 'home' && "scale-110")} />
                <span className="text-[10px] font-bold uppercase tracking-widest">Home</span>
              </button>
              
              <div className="flex-1 flex justify-center -mt-12">
                <button 
                  onClick={() => {
                    fileInputRef.current?.click();
                  }}
                  className="flex flex-col items-center justify-center w-16 h-16 bg-indigo-600 rounded-full text-white shadow-2xl shadow-indigo-950/50 border-4 border-slate-900 active:scale-90 transition-all hover:scale-105"
                >
                  <Camera className="w-7 h-7" />
                </button>
              </div>

              <button 
                onClick={() => {
                  setView('home');
                }}
                className="flex flex-col items-center gap-1 text-slate-500 hover:text-indigo-400 transition-all active:scale-90 flex-1"
              >
                <History className="w-6 h-6" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Reset</span>
              </button>
            </nav>
          </>
        )}
        
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
          accept="image/*" 
          className="hidden" 
        />
      </div>
    </ErrorBoundary>
  );
}
