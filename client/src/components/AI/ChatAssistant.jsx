import { useState, useRef, useEffect } from 'react';
import API from '../../api/axios';
import {
    HiOutlinePaperAirplane,
    HiOutlineSparkles,
    HiOutlineMicrophone,
    HiOutlineStop,
    HiOutlineExclamationTriangle
} from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { AdvisorMarkdown } from '../../utils/advisorFormatter';
import { LiveAudioSession } from '../../services/liveAudioService';
import { loadGeminiKeys } from '../../services/geminiKeys';
import { getAIProviderStatus, subscribeAIProviderSettings } from '../../services/ai/providerSettings';

const SUGGESTED_QUESTIONS = [
    "Where did my money go?",
    "How can I save more?",
    "Am I spending too much?",
    "Which category costs me the most?",
    "What should I reduce?"
];

const ChatAssistant = () => {
    const [messages, setMessages] = useState([
        {
            role: 'assistant',
            content: "Hello! I am your AI Financial Advisor. I look at your recorded expenses and budget plan to answer questions about where your money is going and how you can save more. Choose a suggested question below, type your own, or tap the microphone to talk with the real-time Live Voice Advisor."
        }
    ]);
    const [input, setInput] = useState('');
    const [contextTimeframe, setContextTimeframe] = useState('All');
    const [loading, setLoading] = useState(false);
    const [liveState, setLiveState] = useState('idle'); // idle | connecting | active
    const [liveTranscript, setLiveTranscript] = useState('');
    const [providerStatus, setProviderStatus] = useState(() => getAIProviderStatus());

    const messagesEndRef = useRef(null);
    const liveSessionRef = useRef(null);

    useEffect(() => subscribeAIProviderSettings(setProviderStatus), []);

    const geminiAvailable = providerStatus.gemini.enabled && providerStatus.gemini.configured;

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading, liveTranscript]);

    // Clean up live session on unmount
    useEffect(() => {
        return () => {
            if (liveSessionRef.current) {
                liveSessionRef.current.stop();
            }
        };
    }, []);

    const toggleLiveSession = async () => {
        if (liveState === 'active' || liveState === 'connecting') {
            if (liveSessionRef.current) {
                liveSessionRef.current.stop();
                liveSessionRef.current = null;
            }
            setLiveState('idle');
            setLiveTranscript('');
            toast.success('Live voice session ended');
            return;
        }

        if (!providerStatus.gemini.enabled) {
            toast.error('Live Voice requires Google Gemini. Enable Gemini in AI Settings in the sidebar.');
            return;
        }
        if (!providerStatus.gemini.configured) {
            toast.error('Live Voice requires a Gemini API key. Add one in AI Settings in the sidebar.');
            return;
        }

        try {
            setLiveState('connecting');
            const activeKey = loadGeminiKeys()[0]
                || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY)
                || '';
            const session = new LiveAudioSession({
                apiKey: activeKey,
                onStateChange: (state) => {
                    setLiveState(state);
                },
                onMessage: (msg) => {
                    if (msg.outputTranscript) {
                        setLiveTranscript(prev => prev + ' ' + msg.outputTranscript);
                    }
                    if (msg.text) {
                        setLiveTranscript(prev => prev + ' ' + msg.text);
                    }
                    if (msg.closed) {
                        setLiveState('idle');
                    }
                },
                onError: (err) => {
                    toast.error(err.message || 'Live voice session error');
                    setLiveState('idle');
                }
            });

            liveSessionRef.current = session;
            await session.start();
            toast.success('Live Voice Advisor connected! Start speaking.');
        } catch (err) {
            toast.error(err.message || 'Microphone access denied or connection failed');
            setLiveState('idle');
        }
    };

    const sendMessage = async (messageText = null) => {
        const text = (messageText || input).trim();
        if (!text || loading) return;

        const userMsg = { role: 'user', content: text };
        // Keep a short rolling window of prior turns so follow-up questions
        // like "and last month?" resolve correctly. The greeting and empty
        // placeholders are excluded.
        const conversationHistory = messages
            .filter(message => message.content
                && !(message.role === 'assistant'
                    && message.content.startsWith('Hello! I am your AI Financial Advisor')))
            .slice(-10)
            .map(message => ({ role: message.role, content: message.content }));

        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        // Placeholder assistant message while the local AI service runs.
        setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

        try {
            // The AI service calls Gemini directly from this device. No
            // backend/streaming endpoint is required, so the same code path
            // works in the desktop browser and inside the Capacitor WebView.
            const res = await API.post('/ai/chat', {
                message: text,
                timeframe: contextTimeframe,
                history: conversationHistory
            });
            const reply = res.data?.data?.reply;
            if (!reply) {
                throw new Error('The AI returned an empty response. Please try again.');
            }
            setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', content: reply };
                return next;
            });
        } catch (err) {
            const message = err.response?.data?.message || err.message || 'Failed to get response';
            toast.error(message);
            setMessages(prev => {
                const next = [...prev];
                next[next.length - 1] = {
                    role: 'assistant',
                    content: `I could not complete that request. ${message}`
                };
                return next;
            });
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <div className="card chat-assistant-card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            {/* Header — sticky, never scrolls */}
            <div style={{ 
                padding: '1rem 1.25rem', 
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'var(--bg-surface)',
                flexShrink: 0
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--color-primary-subtle)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <HiOutlineSparkles aria-hidden="true" />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Financial Advisor Chat</h2>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Text advisor: {providerStatus.activeProviderLabel || 'not configured'} · Live Voice: Gemini
                        </span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    {/* Live Voice API Button */}
                    <button
                        type="button"
                        onClick={toggleLiveSession}
                        className={`btn btn-sm ${liveState === 'active' ? 'btn-danger' : 'btn-outline'}`}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-full)',
                            padding: '0.3rem 0.75rem',
                            fontSize: '0.78rem',
                            borderColor: liveState === 'active' ? 'var(--color-danger)' : 'var(--color-primary)',
                            color: liveState === 'active' ? '#FFFFFF' : 'var(--color-primary)',
                            backgroundColor: liveState === 'active' ? 'var(--color-danger)' : 'var(--color-primary-subtle)'
                        }}
                        title={liveState === 'active' ? 'Stop Live Voice Session' : 'Start Live Voice Session (Gemini 3.8 Live)'}
                        aria-label="Toggle Live Voice Advisor"
                    >
                        {liveState === 'active' ? (
                            <>
                                <HiOutlineStop aria-hidden="true" />
                                <span>End Voice</span>
                            </>
                        ) : liveState === 'connecting' ? (
                            <>
                                <span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '2px' }} />
                                <span>Connecting...</span>
                            </>
                        ) : (
                            <>
                                <HiOutlineMicrophone aria-hidden="true" />
                                <span>Live Voice</span>
                            </>
                        )}
                    </button>

                    <label htmlFor="chat-timeframe" className="sr-only">Data Timeframe</label>
                    <select
                        id="chat-timeframe"
                        value={contextTimeframe}
                        onChange={(e) => setContextTimeframe(e.target.value)}
                        className="form-select"
                        style={{ minHeight: '34px', padding: '0.2rem 0.5rem', fontSize: '0.8125rem', width: 'auto' }}
                    >
                        <option value="This Month">This Month</option>
                        <option value="This Year">This Year</option>
                        <option value="All">All Time</option>
                    </select>
                </div>
            </div>

            {/* Live Audio Banner when Live session is active */}
            {liveState === 'active' && (
                <div style={{
                    backgroundColor: '#ECFDF5',
                    borderBottom: '1px solid #A7F3D0',
                    padding: '0.65rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.8125rem',
                    color: '#065F46',
                    flexShrink: 0
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                            display: 'inline-block',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: '#059669',
                            animation: 'pulse 1.5s infinite'
                        }} />
                        <strong>Live Voice Advisor Active (Gemini 3.8 Live):</strong> Speak freely into your microphone.
                    </div>
                    {liveTranscript && (
                        <span style={{ fontSize: '0.75rem', color: '#047857', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {liveTranscript}
                        </span>
                    )}
                </div>
            )}

            {/* Suggested Question Pills */}
            <div style={{ 
                padding: '0.625rem 1rem', 
                backgroundColor: 'var(--bg-surface-subtle)', 
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                gap: '0.35rem',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                WebkitOverflowScrolling: 'touch'
            }}>
                {SUGGESTED_QUESTIONS.map(q => (
                    <button
                        key={q}
                        type="button"
                        onClick={() => sendMessage(q)}
                        disabled={loading || liveState === 'active'}
                        className="btn btn-outline btn-sm"
                        style={{ height: '32px', borderRadius: 'var(--radius-full)', fontSize: '0.8125rem', padding: '0 10px', backgroundColor: '#FFFFFF', flexShrink: 0 }}
                    >
                        {q}
                    </button>
                ))}
            </div>

            {/* Chat Messages Log */}
            <div style={{ 
                flex: 1, 
                padding: '1.25rem', 
                overflowY: 'auto',
                overflowX: 'hidden',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '1rem',
                backgroundColor: 'var(--bg-primary)',
                minHeight: 0,
                WebkitOverflowScrolling: 'touch'
            }}>
                {messages.map((msg, index) => {
                    const isUser = msg.role === 'user';
                    return (
                        <div
                            key={index}
                            style={{
                                alignSelf: isUser ? 'flex-end' : 'flex-start',
                                maxWidth: isUser ? '85%' : '92%',
                                display: 'flex',
                                flexDirection: 'column'
                            }}
                        >
                            <span style={{ 
                                fontSize: '0.72rem', 
                                fontWeight: 600, 
                                color: 'var(--text-muted)', 
                                marginBottom: '0.25rem',
                                alignSelf: isUser ? 'flex-end' : 'flex-start'
                            }}>
                                {isUser ? 'You' : 'AI Advisor'}
                            </span>
                            <div style={{
                                padding: '0.875rem 1.125rem',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: isUser ? 'var(--color-primary)' : 'var(--bg-surface)',
                                color: isUser ? 'var(--text-inverse)' : 'var(--text-primary)',
                                border: isUser ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                boxShadow: 'var(--shadow-sm)',
                                fontSize: '0.9375rem',
                                lineHeight: '1.5'
                            }}>
                                {isUser ? (
                                    <p style={{ margin: 0, color: 'inherit' }}>{msg.content}</p>
                                ) : (
                                    msg.content ? (
                                        <AdvisorMarkdown content={msg.content} />
                                    ) : (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                                            <div className="spinner" style={{ width: '14px', height: '14px' }} />
                                            <span style={{ fontSize: '0.85rem' }}>Thinking...</span>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    );
                })}

                {loading && messages[messages.length - 1]?.content !== '' && (
                    <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
                        <div style={{
                            padding: '0.75rem 1rem',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: 'var(--text-secondary)',
                            fontSize: '0.875rem'
                        }}>
                            <div className="spinner" style={{ width: '18px', height: '18px' }} />
                            Consulting your spending history...
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <div style={{ 
                padding: '0.875rem 1.25rem', 
                borderTop: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-surface)',
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                flexShrink: 0
            }}>
                <label htmlFor="chat-input" className="sr-only">Ask a financial question</label>
                <input
                    id="chat-input"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={liveState === 'active' ? 'Live voice active — speak into your mic or type here...' : 'Ask about your spending, leaks, or savings...'}
                    className="form-input"
                    disabled={loading}
                    style={{ flex: 1, minHeight: '44px' }}
                />
                <button
                    type="button"
                    onClick={() => sendMessage()}
                    disabled={loading || !input.trim()}
                    className="btn btn-primary"
                    aria-label="Send message to AI Advisor"
                    style={{ minWidth: '44px', minHeight: '44px', padding: 0 }}
                >
                    <HiOutlinePaperAirplane aria-hidden="true" style={{ fontSize: '1.15rem' }} />
                </button>
            </div>
        </div>
    );
};

export default ChatAssistant;
