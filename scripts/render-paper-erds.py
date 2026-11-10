"""Reproducible, portrait process ERDs. Requires reportlab, svglib and pymupdf.

Run from the repository root after `npx tsx scripts/export-erd-schema.ts`.
Definitions retain the verified scope; the geometry helper prints at exactly 6.5 inches.
Node x/y values select their conceptual column and row, not connector coordinates.
"""
from pathlib import Path
import json
import hashlib
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/diagrams/paper'
W, BOX, HEADER, ROW = 676, 156, 42, 20
SCHEMA = json.loads((OUT / 'schema-reference.json').read_text())
FIGURES = []

def node(table, x, y, fields):
    return dict(table=table, x=x, y=y, fields=fields.split(), h=HEADER + ROW * len(fields.split()) + 4)

def edge(parent, child, fk, parent_card='1', child_card='0..N'):
    return dict(parent=parent, child=child, fk=fk, cards=[parent_card, child_card])

FIGURES.append(dict(number=7, slug='class-preparation', title='Class Preparation', height=620,
 nodes=[
  node('academic_years',8,8,'id start_year starts_on ends_on status'),
  node('staff',170,8,'user_id display_name role active'),
  node('reporting_periods',332,8,'id academic_year_id ordinal name starts_on ends_on'),
  node('sections',170,200,'id academic_year_id grade_level name adviser_user_id'),
  node('import_previews',332,200,'id actor_user_id input_hash plan_hash row_count expires_at committed_at'),
  node('learners',8,390,'id lrn first_name last_name birth_date sex merged_into'),
  node('enrollments',170,390,'id learner_id academic_year_id grade_level section_id enrolled_on effective_on status record_state'),
  node('enrollment_events',332,410,'id enrollment_id enrollment_version event_type effective_on section_id reason'),
 ], edges=[
  edge('academic_years','reporting_periods','academic_year_id'),
  edge('academic_years','sections','academic_year_id'),
  edge('staff','sections','adviser_user_id','0..1'),
  edge('staff','import_previews','actor_user_id'),
  edge('academic_years','enrollments','academic_year_id'),
  edge('sections','enrollments','section_id'),
  edge('learners','enrollments','learner_id'),
  edge('enrollments','enrollment_events','enrollment_id'),
  edge('sections','enrollment_events','section_id'),
 ], notes=[
  'One valid enrollment per learner and school year; voided records remain as evidence.',
  'Section placement also checks year and grade. An adviser may be unassigned.',
  'Movement events are original history; correction and identity journals are omitted.',
 ]))

FIGURES.append(dict(number=8, slug='attendance-record', title='Attendance Record', height=730,
 nodes=[
  node('academic_years',8,8,'id start_year status'),
  node('sections',170,8,'id academic_year_id grade_level name adviser_user_id'),
  node('staff',332,8,'user_id display_name role active'),
  node('instructional_calendars',8,185,'id version'),
  node('attendance_days',170,185,'id section_id day_on version'),
  node('enrollments',332,185,'id learner_id section_id status record_state'),
  node('instructional_days',8,365,'id academic_year_id section_id day_on configured am pm'),
  node('attendance_months',170,365,'id section_id academic_year_id month_on status snapshot_id'),
  node('attendance_marks',332,365,'id attendance_day_id enrollment_id day_on am pm'),
  node('attendance_month_snapshots',8,560,'id section_id academic_year_id month_on payload data_hash'),
  node('attendance_followups',332,550,'id enrollment_id section_id assignee_user_id category status opening_evidence'),
 ], edges=[
  edge('academic_years','instructional_calendars','id',child_card='0..1'),
  edge('academic_years','sections','academic_year_id'),
  edge('staff','sections','adviser_user_id','0..1'),
  edge('instructional_calendars','instructional_days','academic_year_id'),
  edge('sections','instructional_days','section_id','0..1'),
  edge('sections','attendance_days','section_id'),
  edge('attendance_days','attendance_marks','attendance_day_id'),
  edge('enrollments','attendance_marks','enrollment_id'),
  edge('sections','attendance_months','section_id'),
  edge('attendance_month_snapshots','attendance_months','snapshot_id',child_card='0..1'),
  edge('enrollments','attendance_followups','enrollment_id'),
  edge('staff','attendance_followups','assignee_user_id'),
 ], notes=[
  'No configured date means unknown; a null AM/PM mark means not recorded.',
  'A saved month references one snapshot. Before first submission, its draft is virtual.',
  'Follow-ups are manual. Official attendance credits and automatic alerts remain gated.',
 ]))

FIGURES.append(dict(number=9, slug='academic-record', title='Academic Record', height=775,
 nodes=[
  node('academic_years',8,8,'id start_year status'),
  node('assessment_policy_drafts',170,8,'id code components grade_levels status'),
  node('subjects',332,8,'id code name kind grade_levels'),
  node('reporting_periods',8,200,'id academic_year_id ordinal name'),
  node('assessment_policy_adoptions',170,200,'id academic_year_id policy_id policy_version policy_snapshot adopted_on status'),
  node('sections',332,200,'id academic_year_id grade_level name'),
  node('enrollments',8,402,'id learner_id section_id record_state'),
  node('assessment_policy_bindings',170,402,'id offering_id adoption_id status version'),
  node('section_subjects',332,402,'id section_id subject_id subject_snapshot active'),
  node('assessment_scores',8,600,'id task_id enrollment_id raw_score version'),
  node('assessment_tasks',170,565,'id offering_id binding_id reporting_period_id component_code sequence max_score status'),
 ], edges=[
  edge('academic_years','reporting_periods','academic_year_id'),
  edge('academic_years','assessment_policy_adoptions','academic_year_id'),
  edge('assessment_policy_drafts','assessment_policy_adoptions','policy_id'),
  edge('subjects','section_subjects','subject_id'),
  edge('sections','section_subjects','section_id'),
  edge('assessment_policy_adoptions','assessment_policy_bindings','adoption_id'),
  edge('section_subjects','assessment_policy_bindings','offering_id'),
  edge('assessment_policy_bindings','assessment_tasks','binding_id'),
  edge('section_subjects','assessment_tasks','offering_id'),
  edge('reporting_periods','assessment_tasks','reporting_period_id'),
  edge('assessment_tasks','assessment_scores','task_id'),
  edge('enrollments','assessment_scores','enrollment_id'),
 ], notes=[
  'An offering may retain many bindings; at most one is currently bound.',
  'Adoption and subject snapshots preserve the selected revisions.',
  'Only raw scores are stored. Null is unrecorded; no grade is computed.',
 ]))


from paper_erd_geometry import render_figures, validate

if __name__ == '__main__':
    migration_dir = ROOT / 'database/migrations'
    assert sorted(p.name for p in migration_dir.glob('*.sql')) == [m['file'] for m in SCHEMA['migrations']], 'Schema metadata is stale; export it again.'
    for migration in SCHEMA['migrations']:
        assert hashlib.sha256((migration_dir / migration['file']).read_bytes()).hexdigest() == migration['sha256'], 'Schema metadata is stale; export it again.'
    render_figures(FIGURES, SCHEMA, ROOT, reuse_routes='--reuse-routes' in sys.argv)
