import { createCookie } from 'react-router';

export const selectedMonthCookie = createCookie('selected_month', {
  maxAge: 60 * 60 * 24 * 90, // 90 days
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true
});

export const selectedUserCookie = createCookie('selected_user', {
  maxAge: 60 * 60 * 24 * 90,
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true
});

export const selectedSourceCookie = createCookie('selected_source', {
  maxAge: 60 * 60 * 24 * 90,
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true
});
