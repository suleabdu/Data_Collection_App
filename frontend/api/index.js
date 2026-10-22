import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service Role key for write permissions
const googleAppsScriptWebhook = process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;

const supabase = createClient(supabaseUrl, supabaseKey);

// Utility: Normalize Phone Number to Nigerian standard (+234...)
function normalizePhone(phone) {
    let raw = String(phone || '').replace(/[\s\-().]/g, '');
    if (raw.startsWith('+234')) return raw;
    if (raw.startsWith('234')) return '+' + raw;
    if (raw.startsWith('0')) return '+234' + raw.slice(1);
    return raw;
}

// Utility: Order-independent Normalized Name Key for duplicate detection
function normalizeName(name) {
    return String(name || '')
        .toUpperCase()
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const action = req.query.action || req.body?.action;

    try {
        // -----------------------------------------------------------------------
        // ACTION 1: Get Geographic Database (Hierarchy or Flat)
        // -----------------------------------------------------------------------
        if (action === 'getGeography') {
            const { data: lgas, error: lgaErr } = await supabase.from('lgas').select('*').order('name');
            const { data: wards, error: wardErr } = await supabase.from('wards').select('*').order('name');
            const { data: pus, error: puErr } = await supabase.from('polling_units').select('*').order('name');

            if (lgaErr || wardErr || puErr) throw new Error('Failed to load geography from database.');

            // Reconstruct nested structure required by public/index.html
            const geoTree = lgas.map(lga => {
                const lgaWards = wards.filter(w => w.lga_code === lga.code).map(ward => {
                    const wardPus = pus.filter(p => p.ward_code === ward.code).map(pu => ({
                        code: pu.code,
                        fullCode: pu.full_code,
                        name: pu.name
                    }));
                    return { code: ward.code, name: ward.name, pollingUnits: wardPus };
                });
                return { code: lga.code, name: lga.name, wards: lgaWards };
            });

            return res.status(200).json({ success: true, status: 'SUCCESS', data: geoTree });
        }

        // -----------------------------------------------------------------------
        // ACTION 2: Submit Coordinator
        // -----------------------------------------------------------------------
        if (action === 'submitCoordinator' && req.method === 'POST') {
            const payload = req.body;
            const {
                name, position, phone, lga, lgaCode, ward, wardCode,
                pollingUnit, pollingUnitCode, notes
            } = payload;

            if (!name || !phone || !lgaCode || !wardCode) {
                return res.status(400).json({
                    success: false,
                    error: { message: 'Missing required coordinator details.' }
                });
            }

            const normPhone = normalizePhone(phone);
            const normName = normalizeName(name);
            const fullPuCode = `${wardCode}/${pollingUnitCode}`;
            const submissionKey = payload.submissionKey || `${normPhone}_${fullPuCode}_${position}`;

            // 1. Idempotency Check: Return existing record if already submitted
            const { data: existingRecord } = await supabase
                .from('coordinator_records')
                .select('*')
                .eq('submission_key', submissionKey)
                .maybeSingle();

            if (existingRecord) {
                return res.status(200).json({
                    success: true,
                    data: {
                        recordId: existingRecord.record_id,
                        message: 'Record retrieved (Duplicate submission key).'
                    }
                });
            }

            // 2. High-Speed Duplicate Detection in Supabase
            const { data: duplicates } = await supabase
                .from('coordinator_records')
                .select('record_id, name, phone, position, full_pu_code')
                .or(`normalized_phone.eq.${normPhone},and(normalized_name.eq.${normName},position.eq.${position})`);

            const duplicateFlag = duplicates && duplicates.length > 0;
            let dupReasons = '';
            if (duplicateFlag) {
                dupReasons = 'Matches existing: ' + duplicates.map(d => d.record_id).join(', ');
            }

            // 3. Generate Sequential Record ID
            const { data: idData, error: idErr } = await supabase.rpc('generate_next_record_id', { prefix: 'REC' });
            const recordId = idErr || !idData ? `REC-${Date.now().toString().slice(-5)}` : idData;

            // 4. Insert Record into Supabase
            const recordData = {
                record_id: recordId,
                submission_key: submissionKey,
                state: 'Ogun',
                state_code: '27',
                name,
                position,
                phone,
                lga_name: lga,
                lga_code: lgaCode,
                ward_name: ward,
                ward_code: wardCode,
                polling_unit_name: pollingUnit,
                polling_unit_code: pollingUnitCode,
                full_pu_code: fullPuCode,
                verification_status: 'PENDING',
                duplicate_flag: duplicateFlag,
                duplicate_reasons: dupReasons,
                notes: notes || '',
                normalized_name: normName,
                normalized_phone: normPhone
            };

            const { data: insertedRecord, error: insertErr } = await supabase
                .from('coordinator_records')
                .insert([recordData])
                .select()
                .single();

            if (insertErr) throw insertErr;

            // 5. Asynchronous Webhook to Google Sheets (Non-blocking)
            if (googleAppsScriptWebhook) {
                fetch(googleAppsScriptWebhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'asyncSyncRow', record: insertedRecord })
                }).catch(err => console.error('Background Sheets Sync failed:', err));
            }

            return res.status(200).json({
                success: true,
                data: {
                    recordId: recordId,
                    message: 'Coordinator registered successfully.'
                }
            });
        }

        return res.status(404).json({ success: false, error: { message: 'Action not found.' } });

    } catch (err) {
        console.error('API Error:', err);
        return res.status(500).json({
            success: false,
            error: { message: err.message || 'Internal Server Error' }
        });
    }
}