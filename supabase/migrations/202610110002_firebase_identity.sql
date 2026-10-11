drop policy if exists "Users manage their own profile" on public.profiles;
drop policy if exists "Users manage their own notes" on public.notes;
drop policy if exists "Users manage their own contacts" on public.contacts;
drop policy if exists "Users manage their own reminders" on public.reminders;
drop policy if exists "Users manage their own settings" on public.user_settings;
drop policy if exists "Users manage their own conversations" on public.assistant_conversations;
drop policy if exists "Users manage their own messages" on public.assistant_messages;
drop policy if exists "Users manage their own activity" on public.activity_events;

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.notes drop constraint if exists notes_user_id_fkey;
alter table public.contacts drop constraint if exists contacts_user_id_fkey;
alter table public.reminders drop constraint if exists reminders_user_id_fkey;
alter table public.user_settings drop constraint if exists user_settings_user_id_fkey;
alter table public.assistant_conversations drop constraint if exists assistant_conversations_user_id_fkey;
alter table public.assistant_messages drop constraint if exists assistant_messages_user_id_fkey;
alter table public.assistant_messages drop constraint if exists assistant_messages_conversation_id_user_id_fkey;
alter table public.activity_events drop constraint if exists activity_events_user_id_fkey;

alter table public.notes alter column user_id drop default;
alter table public.contacts alter column user_id drop default;
alter table public.reminders alter column user_id drop default;
alter table public.user_settings alter column user_id drop default;
alter table public.assistant_conversations alter column user_id drop default;
alter table public.assistant_messages alter column user_id drop default;
alter table public.activity_events alter column user_id drop default;

alter table public.profiles alter column id type text using id::text;
alter table public.notes alter column user_id type text using user_id::text;
alter table public.contacts alter column user_id type text using user_id::text;
alter table public.reminders alter column user_id type text using user_id::text;
alter table public.user_settings alter column user_id type text using user_id::text;
alter table public.assistant_conversations alter column user_id type text using user_id::text;
alter table public.assistant_messages alter column user_id type text using user_id::text;
alter table public.activity_events alter column user_id type text using user_id::text;

alter table public.assistant_messages
  add constraint assistant_messages_conversation_id_user_id_fkey
  foreign key (conversation_id, user_id)
  references public.assistant_conversations (id, user_id) on delete cascade;

create or replace function public.current_firebase_uid()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

alter table public.notes alter column user_id set default public.current_firebase_uid();
alter table public.contacts alter column user_id set default public.current_firebase_uid();
alter table public.reminders alter column user_id set default public.current_firebase_uid();
alter table public.user_settings alter column user_id set default public.current_firebase_uid();
alter table public.assistant_conversations alter column user_id set default public.current_firebase_uid();
alter table public.assistant_messages alter column user_id set default public.current_firebase_uid();
alter table public.activity_events alter column user_id set default public.current_firebase_uid();

create policy "Users manage their own profile" on public.profiles
  for all to authenticated
  using (id = (select public.current_firebase_uid()))
  with check (id = (select public.current_firebase_uid()));
create policy "Users manage their own notes" on public.notes
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
create policy "Users manage their own contacts" on public.contacts
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
create policy "Users manage their own reminders" on public.reminders
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
create policy "Users manage their own settings" on public.user_settings
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
create policy "Users manage their own conversations" on public.assistant_conversations
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
create policy "Users manage their own messages" on public.assistant_messages
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (
    user_id = (select public.current_firebase_uid()) and exists (
      select 1 from public.assistant_conversations conversation
      where conversation.id = conversation_id
        and conversation.user_id = (select public.current_firebase_uid())
    )
  );
create policy "Users manage their own activity" on public.activity_events
  for all to authenticated
  using (user_id = (select public.current_firebase_uid()))
  with check (user_id = (select public.current_firebase_uid()));
