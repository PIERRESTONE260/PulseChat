-- ============================================================================
-- SCHEMA SQL COMPLET - APPLICATION DE MESSAGERIE V1
-- À exécuter dans : Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. TABLE DES PROFILS UTILISATEURS
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT NULL,
    bio TEXT DEFAULT '',
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT username_format CHECK (username ~* '^[a-z0-9_]{3,24}$'),
    CONSTRAINT full_name_length CHECK (char_length(trim(full_name)) >= 2 AND char_length(full_name) <= 60),
    CONSTRAINT bio_length CHECK (char_length(bio) <= 160)
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_full_name ON public.profiles(full_name);

-- 3. TABLE DES CONVERSATIONS PRIVÉES
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Clé canonique "uuid_min:uuid_max" pour empêcher mathématiquement tout doublon 1-à-1
    direct_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_preview TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON public.conversations(last_message_at DESC);

-- 4. TABLE DES MEMBRES DE CONVERSATION
CREATE TABLE IF NOT EXISTS public.conversation_members (
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_members_user_id ON public.conversation_members(user_id);

-- 5. TABLE DES MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT message_not_empty CHECK (char_length(trim(content)) > 0),
    CONSTRAINT message_max_length CHECK (char_length(content) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages(conversation_id, is_read) WHERE is_read = FALSE;

-- ============================================================================
-- 6. FONCTIONS & TRIGGERS AUTOMATIQUES
-- ============================================================================

-- A. Création automatique du profil lors de l'inscription via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    raw_username TEXT;
    raw_fullname TEXT;
BEGIN
    raw_username := LOWER(TRIM(COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substr(NEW.id::text, 1, 8))));
    raw_fullname := TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', 'Utilisateur'));

    INSERT INTO public.profiles (id, username, full_name)
    VALUES (NEW.id, raw_username, raw_fullname);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- B. Mise à jour automatique de updated_at sur profiles
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- C. Mise à jour automatique de la conversation lors d'un nouveau message
CREATE OR REPLACE FUNCTION public.handle_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.conversations
    SET 
        last_message_at = NEW.created_at,
        last_message_preview = LEFT(NEW.content, 100)
    WHERE id = NEW.conversation_id;

    -- Marquer la conversation comme lue pour l'expéditeur
    UPDATE public.conversation_members
    SET last_read_at = NEW.created_at
    WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_message_inserted ON public.messages;
CREATE TRIGGER on_message_inserted
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_message();

-- D. Fonction sécurisée pour vérifier la disponibilité d'un username avant inscription
CREATE OR REPLACE FUNCTION public.is_username_available(check_username TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE LOWER(username) = LOWER(TRIM(check_username))
    );
END;
$$;

-- E. Fonction atomique pour obtenir ou créer une conversation privée entre 2 utilisateurs
-- Empêche la création de doublons et empêche un utilisateur d'ajouter des tiers arbitrairement
CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(target_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    current_uid UUID := auth.uid();
    sorted_key TEXT;
    conv_id UUID;
BEGIN
    IF current_uid IS NULL THEN
        RAISE EXCEPTION 'Utilisateur non authentifié';
    END IF;

    IF target_user_id IS NULL OR target_user_id = current_uid THEN
        RAISE EXCEPTION 'Destinataire invalide';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user_id) THEN
        RAISE EXCEPTION 'Utilisateur cible introuvable';
    END IF;

    -- Construction d'une clé déterministe unique quel que soit l'ordre des deux UUID
    IF current_uid::text < target_user_id::text THEN
        sorted_key := current_uid::text || ':' || target_user_id::text;
    ELSE
        sorted_key := target_user_id::text || ':' || current_uid::text;
    END IF;

    -- Vérifier si la conversation existe déjà
    SELECT id INTO conv_id
    FROM public.conversations
    WHERE direct_key = sorted_key;

    IF conv_id IS NOT NULL THEN
        RETURN conv_id;
    END IF;

    -- Sinon créer la conversation et ajouter les 2 membres de manière atomique
    INSERT INTO public.conversations (direct_key)
    VALUES (sorted_key)
    ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
    RETURNING id INTO conv_id;

    INSERT INTO public.conversation_members (conversation_id, user_id)
    VALUES 
        (conv_id, current_uid),
        (conv_id, target_user_id)
    ON CONFLICT DO NOTHING;

    RETURN conv_id;
END;
$$;

-- ============================================================================
-- 7. SÉCURITÉ : ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Fonction helper pour éviter la récursion infinie RLS sur conversation_members
CREATE OR REPLACE FUNCTION public.is_member_of_conversation(conv_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.conversation_members
        WHERE conversation_id = conv_id AND user_id = auth.uid()
    );
$$;

-- POLITIQUES SUR PROFILES
-- Tous les utilisateurs authentifiés peuvent voir les profils publics (aucun email n'est dans cette table)
CREATE POLICY "Profiles visibles par utilisateurs connectés"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

-- Un utilisateur ne peut modifier que son propre profil
CREATE POLICY "Modification de son propre profil uniquement"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- POLITIQUES SUR CONVERSATIONS
-- Un utilisateur ne voit que les conversations auxquelles il participe
CREATE POLICY "Lecture de ses propres conversations"
ON public.conversations FOR SELECT
TO authenticated
USING (public.is_member_of_conversation(id));

-- Aucune insertion directe autorisée (passe obligatoirement par la RPC get_or_create_direct_conversation)
CREATE POLICY "Aucune insertion directe dans conversations"
ON public.conversations FOR INSERT
TO authenticated
WITH CHECK (false);

-- POLITIQUES SUR CONVERSATION_MEMBERS
-- Un utilisateur voit les membres des conversations dont il fait partie
CREATE POLICY "Lecture des membres de ses conversations"
ON public.conversation_members FOR SELECT
TO authenticated
USING (public.is_member_of_conversation(conversation_id));

-- Un utilisateur peut mettre à jour sa propre date de lecture (last_read_at)
CREATE POLICY "Mise à jour de sa propre lecture"
ON public.conversation_members FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Aucune insertion directe dans conversation_members (géré par la RPC sécurisée)
CREATE POLICY "Aucune insertion directe de membres"
ON public.conversation_members FOR INSERT
TO authenticated
WITH CHECK (false);

-- POLITIQUES SUR MESSAGES
-- Un utilisateur ne lit que les messages des conversations dont il est membre
CREATE POLICY "Lecture des messages de ses conversations"
ON public.messages FOR SELECT
TO authenticated
USING (public.is_member_of_conversation(conversation_id));

-- Un utilisateur ne peut envoyer un message que dans une conversation dont il est membre, et en son propre nom
CREATE POLICY "Envoi de messages dans ses conversations uniquement"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (
    sender_id = auth.uid()
    AND public.is_member_of_conversation(conversation_id)
);

-- Un destinataire peut marquer comme lus les messages reçus dans sa conversation
CREATE POLICY "Marquer les messages reçus comme lus"
ON public.messages FOR UPDATE
TO authenticated
USING (
    sender_id <> auth.uid()
    AND public.is_member_of_conversation(conversation_id)
)
WITH CHECK (
    sender_id <> auth.uid()
    AND public.is_member_of_conversation(conversation_id)
);

-- ============================================================================
-- 8. ACTIVATION DE SUPABASE REALTIME
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- ============================================================================
-- 9. CONFIGURATION SUPABASE STORAGE (AVATARS)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    true,
    2097152, -- 2 Mo maximum
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique des avatars
CREATE POLICY "Avatars accessibles publiquement"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Chaque utilisateur ne peut uploader que dans un dossier portant son propre UUID
CREATE POLICY "Upload de son propre avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Chaque utilisateur ne peut modifier que son propre avatar
CREATE POLICY "Modification de son propre avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Chaque utilisateur ne peut supprimer que son propre avatar
CREATE POLICY "Suppression de son propre avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
);