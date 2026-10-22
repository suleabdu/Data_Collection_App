#!/usr/bin/env python3
"""Prepare CSV exports of the existing TK27 Google Sheet for Supabase import.

Usage:
  python scripts/prepare_sheet_exports.py MASTER_GEOGRAPHY.csv COORDINATOR_RECORDS.csv

The input files are downloaded from Google Sheets. Output files are written to
migration-data/ and intentionally git-ignored because coordinator data is personal data.
"""
from __future__ import annotations
import csv
import re
import sys
from pathlib import Path
from typing import Dict, Iterable

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'migration-data'
OUT.mkdir(exist_ok=True)


def norm_header(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (value or '').strip().lower())


def get(row: Dict[str, str], *names: str, default: str = '') -> str:
    lookup = {norm_header(k): (v or '').strip() for k, v in row.items()}
    for name in names:
        if norm_header(name) in lookup:
            return lookup[norm_header(name)]
    return default


def as_bool(value: str) -> str:
    return 'true' if str(value or '').strip().upper() in ('TRUE', 'YES', '1', 'Y') else 'false'


def normalize_master_status(value: str) -> str:
    # Apps Script publishes valid rows as ACTIVE; Supabase uses VALID as its public lookup state.
    status = (value or '').strip().upper()
    if not status or status in ('ACTIVE', 'VALID'):
        return 'VALID'
    return 'INVALID'


def normalize_phone(value: str) -> str:
    original = (value or '').strip()
    digits = re.sub(r'\D', '', original)
    if len(digits) == 11 and digits.startswith('0'):
        return '+234' + digits[1:]
    if len(digits) == 13 and digits.startswith('234'):
        return '+' + digits
    if len(digits) == 10 and digits[0:1] in ('7', '8', '9'):
        return '+234' + digits
    return original


def normalize_name(value: str) -> str:
    words = re.sub(r'[^\w\s]', ' ', (value or '').upper(), flags=re.UNICODE).split()
    return ' '.join(sorted(words))


def read_csv(path: Path) -> list[Dict[str, str]]:
    with path.open('r', encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, headers: Iterable[str], rows: Iterable[Dict[str, str]]) -> None:
    with path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(headers), extrasaction='ignore', lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)


def convert_master(path: Path) -> int:
    rows = read_csv(path)
    out = []
    issues = []
    for i, r in enumerate(rows, start=2):
        lga_code = get(r, 'LGA_Code')
        ward_code = get(r, 'Ward_Code')
        pu_code = get(r, 'Polling_Unit_Code')
        full_code = get(r, 'Full_PU_Code')
        if not full_code and re.fullmatch(r'\d{2}/\d{2}/\d{2}/\d{3}', pu_code):
            full_code, pu_code = pu_code, pu_code.rsplit('/', 1)[-1]
        elif not full_code and ward_code and pu_code:
            pu_code = pu_code.zfill(3) if pu_code.isdigit() else pu_code
            full_code = ward_code + '/' + pu_code
        lga = get(r, 'LGA')
        ward = get(r, 'Ward')
        pu = get(r, 'Polling_Unit')
        if not full_code or not lga_code or not ward_code or not lga or not ward or not pu:
            issues.append(f'MASTER_GEOGRAPHY row {i}: missing a required geography field (Full_PU_Code={full_code!r}).')
            continue
        out.append({
            'full_pu_code': full_code,
            'state': get(r, 'State', default='Ogun') or 'Ogun',
            'state_code': get(r, 'State_Code', default='OG') or 'OG',
            'lga': lga, 'lga_code': lga_code, 'ward': ward, 'ward_code': ward_code,
            'polling_unit': pu, 'polling_unit_code': pu_code,
            'status': normalize_master_status(get(r, 'Status', default='VALID')),
            'source': get(r, 'Source'), 'source_date': get(r, 'Source_Date'),
            'created_at': get(r, 'Created_At'), 'updated_at': get(r, 'Updated_At')
        })
    if issues:
        raise ValueError('\n'.join(issues[:30]) + (f'\n... and {len(issues)-30} more.' if len(issues) > 30 else ''))
    write_csv(OUT / 'master_geography.csv', out[0].keys() if out else [
        'full_pu_code','state','state_code','lga','lga_code','ward','ward_code','polling_unit','polling_unit_code','status','source','source_date','created_at','updated_at'], out)
    return len(out)


def convert_records(path: Path) -> int:
    rows = read_csv(path)
    out = []
    issues = []
    headers = ['record_id','state','state_code','name','position','phone','lga','lga_code','ward','ward_code',
               'polling_unit','polling_unit_code','verification_status','duplicate_flag','submitted_at','updated_at',
               'submitted_by','notes','submission_key','normalized_name','normalized_phone']
    for i, r in enumerate(rows, start=2):
        record_id = get(r, 'Record_ID')
        name = get(r, 'Name', 'Full_Name')
        submitted_at = get(r, 'Submitted_At', 'Timestamp')
        if not record_id or not name or not submitted_at:
            issues.append(f'COORDINATOR_RECORDS row {i}: Record_ID, Name and Submitted_At are required.')
            continue
        phone = normalize_phone(get(r, 'Phone'))
        out.append({
            'record_id': record_id,
            'state': get(r, 'State', default='Ogun') or 'Ogun',
            'state_code': get(r, 'State_Code', default='OG') or 'OG',
            'name': name,
            'position': get(r, 'Position').upper(),
            'phone': phone,
            'lga': get(r, 'LGA'), 'lga_code': get(r, 'LGA_Code'),
            'ward': get(r, 'Ward'), 'ward_code': get(r, 'Ward_Code'),
            'polling_unit': get(r, 'Polling_Unit'), 'polling_unit_code': get(r, 'Polling_Unit_Code'),
            'verification_status': get(r, 'Verification_Status', default='PENDING').upper() or 'PENDING',
            'duplicate_flag': as_bool(get(r, 'Duplicate_Flag')),
            'submitted_at': submitted_at,
            'updated_at': get(r, 'Updated_At') or submitted_at,
            'submitted_by': get(r, 'Submitted_By', default='legacy-sheet') or 'legacy-sheet',
            'notes': get(r, 'Notes'),
            'submission_key': get(r, 'Submission_Key'),
            'normalized_name': get(r, 'Normalized_Name') or normalize_name(name),
            'normalized_phone': normalize_phone(get(r, 'Normalized_Phone') or phone)
        })
    if issues:
        raise ValueError('\n'.join(issues[:30]) + (f'\n... and {len(issues)-30} more.' if len(issues) > 30 else ''))
    write_csv(OUT / 'coordinator_records.csv', headers, out)
    return len(out)


def main() -> None:
    if len(sys.argv) != 3:
        print('Usage: python scripts/prepare_sheet_exports.py MASTER_GEOGRAPHY.csv COORDINATOR_RECORDS.csv', file=sys.stderr)
        raise SystemExit(2)
    master_path, records_path = (Path(arg).expanduser().resolve() for arg in sys.argv[1:])
    for path in (master_path, records_path):
        if not path.is_file(): raise SystemExit(f'Input file not found: {path}')
    try:
        master_count = convert_master(master_path)
        records_count = convert_records(records_path)
    except ValueError as exc:
        print('Migration stopped; no rows were intentionally skipped. Correct the listed source rows and retry:', file=sys.stderr)
        print(exc, file=sys.stderr)
        raise SystemExit(1)
    print(f'Prepared {master_count:,} geography rows and {records_count:,} coordinator records.')
    print(f'Files are in: {OUT}')
    print('These CSVs contain personal coordinator information. Do not commit migration-data/ to GitHub.')

if __name__ == '__main__':
    main()
