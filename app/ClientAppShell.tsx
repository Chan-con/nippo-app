'use client';

import { useEffect, useState } from 'react';
import ClientApp from './ClientApp';

export default function ClientAppShell(props: { supabaseUrl: string; supabaseAnonKey: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid hydration mismatch by rendering nothing on the server and
  // on the very first client render.
  if (!mounted) return null;

  return <ClientApp supabaseUrl={props.supabaseUrl} supabaseAnonKey={props.supabaseAnonKey} />;
}
