import { getSupabaseClient } from '../../src/supabase.js';
import { assertBusinessMutationDisabled } from '../../src/mvp-mode.js';
import { AppAuth } from './auth.js';
import { TaskStore } from '../tasks/task-store.js';

async function getUser() {
  const user = await AppAuth.initialize();
  if (!user) throw new Error('กรุณาเข้าสู่ระบบก่อนดูประกาศ');
  return user;
}

async function getAll() {
  const user = await getUser();
  const permissions = await TaskStore.getPermissions();
  if (!permissions['site_updates.view']) {
    throw new Error('Role ของคุณไม่มีสิทธิ์ดูประกาศ');
  }
  const client = getSupabaseClient();
  const [{ data: updates, error: updatesError }, { data: reads, error: readsError }] =
    await Promise.all([
      client
        .from('site_updates')
        .select('id,title,summary,changes_json,published_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false }),
      client
        .from('site_update_reads')
        .select('update_id')
        .eq('user_id', user.userId)
    ]);

  if (updatesError) throw updatesError;
  if (readsError) throw readsError;
  const readIds = new Set((reads || []).map(read => read.update_id));
  const mappedUpdates = (updates || []).map(update => ({
    id: update.id,
    title: update.title,
    summary: update.summary,
    changes: Array.isArray(update.changes_json) ? update.changes_json : [],
    createdAt: update.published_at,
    isRead: readIds.has(update.id)
  }));
  return {
    updates: mappedUpdates,
    unreadCount: mappedUpdates.filter(update => !update.isRead).length
  };
}

async function markRead(updateId) {
  assertBusinessMutationDisabled();
  const user = await getUser();
  const { error } = await getSupabaseClient()
    .from('site_update_reads')
    .upsert(
      { update_id: updateId, user_id: user.userId },
      { onConflict: 'update_id,user_id', ignoreDuplicates: true }
    );
  if (error) throw error;
}

async function markAllRead() {
  assertBusinessMutationDisabled();
  const user = await getUser();
  const client = getSupabaseClient();
  const { data: updates, error: updatesError } = await client
    .from('site_updates')
    .select('id')
    .eq('is_published', true);
  if (updatesError) throw updatesError;
  if (!updates?.length) return;

  const { error } = await client
    .from('site_update_reads')
    .upsert(
      updates.map(update => ({ update_id: update.id, user_id: user.userId })),
      { onConflict: 'update_id,user_id', ignoreDuplicates: true }
    );
  if (error) throw error;
}

async function getPendingChanges() {
  throw new Error(
    'ตรวจรายการไฟล์ที่เปลี่ยนแปลงไม่ได้บน GitHub Pages: การสแกนเดิมต้องใช้ PHP อ่านไฟล์บนเซิร์ฟเวอร์'
  );
}

async function publish({ title, summary }) {
  assertBusinessMutationDisabled();
  await getUser();
  const cleanTitle = String(title || '').trim();
  const cleanSummary = String(summary || '').trim();
  if (!cleanTitle || cleanTitle.length > 120 || !cleanSummary || cleanSummary.length > 500) {
    throw new Error('กรุณาระบุหัวข้อและสรุปประกาศให้ถูกต้อง');
  }

  const { data, error } = await getSupabaseClient()
    .from('site_updates')
    .insert({
      title: cleanTitle,
      summary: cleanSummary,
      changes_json: []
    })
    .select('id')
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error('Supabase ไม่ได้ส่งรหัสประกาศกลับมา');

  return { id: data.id, message: 'เผยแพร่ประกาศแล้ว' };
}

export const SiteUpdates = {
  getAll,
  markRead,
  markAllRead,
  getPendingChanges,
  publish
};
