import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://qmoksrovighvixenknnq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtb2tzcm92aWdodml4ZW5rbm5xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MzQ0ODIsImV4cCI6MjA4MDAxMDQ4Mn0.9t_7iq3o1gplFjUolLtgaIXbWTh9B7SeO4D8Pr1YqsY'; 

export const supabase = createClient(supabaseUrl, supabaseKey);
