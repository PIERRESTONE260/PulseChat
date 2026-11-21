-- ============================================================================
-- COMPLEMENT SQL V2 : FAVORIS STICKERS/GIF & SUPPORT VIDEO / DOCUMENT
-- ============================================================================

-- 1. Autoriser les types 'video' et 'file' dans messages
ALTER TABLE public.messages
    DROP CONSTRAINT IF EXISTS messages_type_check;

ALTER TABLE public.messages
    ADD CONSTRAINT messages_type_check
    CHECK (type IN ('text', 'image', 'video', 'file', 'audio', 'sticker', 'gif'));

-- 2. Table des favoris (Stickers et GIF enregistrés depuis les discussions ou créés)
CREATE TABLE IF NOT EXISTS public.user_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('sticker', 'gif')),
    media_url TEXT NOT NULL,
    label TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, item_type, media_url)
);

CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON public.user_favorites(user_id, item_type, created_at DESC);

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lecture de ses propres favoris"
ON public.user_favorites FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Ajout à ses propres favoris"
ON public.user_favorites FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Suppression de ses propres favoris"
ON public.user_favorites FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- 3. Mettre à jour le bucket chat-media pour accepter les vidéos MP4/WebM et PDF
UPDATE storage.buckets
SET 
    file_size_limit = 20971520, -- 20 Mo max
    allowed_mime_types = ARRAY[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'video/mp4', 'video/webm', 'video/quicktime',
        'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg',
        'application/pdf'
    ]
WHERE id = 'chat-media';

-- 4. Mettre à jour l'aperçu de dernière activité pour vidéo et document
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    preview_text TEXT;
BEGIN
    IF NEW.type = 'text' THEN
        preview_text := LEFT(NEW.content, 100);
    ELSIF NEW.type = 'image' THEN
        preview_text := COALESCE(NULLIF(TRIM(NEW.content), ''), 'Photo');
    ELSIF NEW.type = 'video' THEN
        preview_text := COALESCE(NULLIF(TRIM(NEW.content), ''), 'Vidéo');
    ELSIF NEW.type = 'file' THEN
        preview_text := COALESCE(NULLIF(TRIM(NEW.content), ''), 'Document');
    ELSIF NEW.type = 'audio' THEN
        preview_text := 'Message vocal';
    ELSIF NEW.type = 'sticker' THEN
        preview_text := 'Sticker';
    ELSIF NEW.type = 'gif' THEN
        preview_text := 'GIF';
    ELSE
        preview_text := 'Nouveau message';
    END IF;

    UPDATE public.conversations
    SET 
        last_message_at = NEW.created_at,
        last_message_preview = preview_text
    WHERE id = NEW.conversation_id;

    UPDATE public.conversation_members
    SET last_read_at = NEW.created_at
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;

    RETURN NEW;
END;
$$;