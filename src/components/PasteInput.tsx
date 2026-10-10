'use client';

import { useState, useRef } from 'react';
import { Send, ClipboardPaste, Image as ImageIcon, FileText, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { uploadImage, uploadDocument } from '@/lib/supabase';
import { htmlToPlainText, readClipboardText } from '@/lib/clipboard';

const MAX_CHARS = 500000;

interface PasteInputProps {
  onSubmit: (
    content: string,
    type: 'text' | 'image' | 'document',
    meta?: { fileName?: string; fileSize?: number }
  ) => Promise<void>;
  disabled?: boolean;
  roomCode: string;
}

export function PasteInput({ onSubmit, disabled, roomCode }: PasteInputProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const charCount = content.length;
  const isOverLimit = charCount > MAX_CHARS;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const clipboardReadVersion = useRef(0);

  const handleImageUpload = async (file: File) => {
    setIsSubmitting(true);
    try {
      const { url, error } = await uploadImage(file, roomCode);
      if (error) {
        toast.error(error);
        return;
      }
      await onSubmit(url, 'image');
      toast.success('Image uploaded!');
    } catch {
      toast.error('Failed to upload image');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDocumentUpload = async (file: File) => {
    setIsSubmitting(true);
    try {
      const { url, fileName, fileSize, error } = await uploadDocument(file, roomCode);
      if (error) {
        toast.error(error);
        return;
      }
      await onSubmit(url, 'document', { fileName, fileSize });
      toast.success('Document uploaded!');
    } catch {
      toast.error('Failed to upload document');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        await handleImageUpload(file);
      } else {
        await handleDocumentUpload(file);
      }
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current += 1;
    if (!disabled && !isSubmitting) {
      setIsDragActive(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragActive(false);
    if (disabled || isSubmitting) return;
    handleFiles(files);
  };

  const handleSubmit = async () => {
    if (!content.trim() || isSubmitting || isOverLimit) return;

    clipboardReadVersion.current += 1;
    setIsSubmitting(true);
    try {
      await onSubmit(content.trim(), 'text');
      setContent('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleDocumentUpload(file);
    }
    // Reset input so same file can be selected again
    if (documentInputRef.current) {
      documentInputRef.current.value = '';
    }
  };

  const handleClipboardPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    clipboardReadVersion.current += 1;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          handleImageUpload(file);
        }
        return;
      }
    }

    // Keep native plain-text pastes (and image priority above) unchanged.
    if (e.clipboardData.getData('text/plain')) return;
    const html = e.clipboardData.getData('text/html');
    if (!html) return;
    const text = htmlToPlainText(html);
    if (!text) return;

    e.preventDefault();
    const textarea = e.currentTarget;
    const { selectionStart, selectionEnd } = textarea;
    setContent((current) => current.slice(0, selectionStart) + text + current.slice(selectionEnd));
    requestAnimationFrame(() => {
      const caret = selectionStart + text.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Ctrl+Enter or Cmd+Enter
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePasteFromClipboard = async () => {
    // Edits, keyboard pastes, sends, and newer reads invalidate this request.
    const version = ++clipboardReadVersion.current;
    try {
      const text = await readClipboardText();
      if (version !== clipboardReadVersion.current) return;
      if (text) {
        setContent(text);
        toast.success('Pasted from clipboard');
      } else {
        toast.error('Clipboard is empty');
      }
    } catch {
      if (version !== clipboardReadVersion.current) return;
      toast.error('Could not access clipboard');
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={`relative rounded-md ${isDragActive ? 'ring-2 ring-primary' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Textarea
          placeholder="Paste or type text here..."
          value={content}
          onChange={(e) => {
            clipboardReadVersion.current += 1;
            setContent(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handleClipboardPaste}
          disabled={disabled || isSubmitting}
          className="min-h-[120px] resize-none pr-20"
        />
        {isDragActive && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-background/90">
            <Upload className="h-6 w-6 text-primary" />
            <p className="text-sm font-medium text-primary">Drop image or document to upload</p>
          </div>
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isSubmitting}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Upload image"
          >
            <ImageIcon className="h-4 w-4" />
          </Button>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            ref={documentInputRef}
            onChange={handleDocumentSelect}
            className="hidden"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => documentInputRef.current?.click()}
            disabled={disabled || isSubmitting}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Upload document"
          >
            <FileText className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handlePasteFromClipboard}
            disabled={disabled || isSubmitting}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            title="Paste from clipboard"
          >
            <ClipboardPaste className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Press Ctrl+Enter to send · Paste image with Ctrl+V · Drag files to upload</span>
        <span className={isOverLimit ? 'text-destructive font-medium' : ''}>
          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={!content.trim() || disabled || isSubmitting || isOverLimit}
        className="w-full h-12"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Send to Cloud
          </>
        )}
      </Button>
    </div>
  );
}
