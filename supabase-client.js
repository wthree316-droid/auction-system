import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://qmoksrovighvixenknnq.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtb2tzcm92aWdodml4ZW5rbm5xIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDQzNDQ4MiwiZXhwIjoyMDgwMDEwNDgyfQ.8QMRjj0qVOFRi_phGaVAvUL-yA9PorMOzocGURbKpyQ
';

export const supabase = createClient(supabaseUrl, supabaseKey);
