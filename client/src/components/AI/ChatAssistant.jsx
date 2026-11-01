import { useState, useRef, useEffect } from 'react';
import API from '../../api/axios';
import { HiOutlinePaperAirplane, HiOutlineSparkles } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { AdvisorMarkdown } from '../../utils/advisorFormatter';

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
            content: "Hello! I am your AI Financial Advisor. I look at your recorded expenses and budget plan to answer questions about where your money is going and how you can save more. Choose a suggested question below or type your own."
        }
    ]);
    const [input, setInput] = useState('');
    const [contextTimeframe, setContextTimeframe] = useState('All');
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef(null);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    const sendMessage = async (messageText = null) => {
        const text = (messageText || input).trim();
        if (!text || loading) return;

        const userMsg = { role: 'user', content: text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setLoading(true);

        try {
            const res = await API.post('/ai/chat', { 
                message: text,
                timeframe: contextTimeframe 
            });
            const aiReply = res.data?.data?.reply || 'I reviewed your data, but could not produce a response. Please try asking again.';
            setMessages(prev => [...prev, { role: 'assistant', content: aiReply }]);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to get response');
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'I encountered an error analyzing your data. Please check your connection or try again.'
            }]);
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
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Answers based strictly on your recorded transactions</span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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

            {/* Suggested Question Pills — horizontal scroll, header stays fixed */}
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
                        disabled={loading}
                        className="btn btn-outline btn-sm"
                        style={{ height: '32px', borderRadius: 'var(--radius-full)', fontSize: '0.8125rem', padding: '0 10px', backgroundColor: '#FFFFFF', flexShrink: 0 }}
                    >
                        {q}
                    </button>
                ))}
            </div>

            {/* Chat Messages Log — this is the only scrollable region */}
            <div style={{ 
                flex: 1, 
                padding: '1.25rem', 
                overflowY: 'auto',
                overflowX: 'hidden',
                display: 'flex', 
                flexDirection: 'column', 
                gap: '1rem',
                backgroundColor: 'var(--bg-primary)',
                minHeight: 0,      /* critical: allows flex child to shrink below content height */
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
                                    <AdvisorMarkdown content={msg.content} />
                                )}
                            </div>
                        </div>
                    );
                })}

                {loading && (
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

            {/* Input Bar — sticky at bottom, never scrolls */}
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
                    placeholder="Ask about your spending, leaks, or savings..."
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
