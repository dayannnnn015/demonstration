"""Focused schema and geometry regression checks; no records or cloud access."""
import json
from pathlib import Path
import unittest

import paper_erd_geometry as g

ROOT=Path(__file__).resolve().parents[1]
SCHEMA=json.loads((ROOT/'docs/diagrams/paper/schema-reference.json').read_text())

class DiagramChecks(unittest.TestCase):
    def test_unique_calendar_fk_is_optional_one(self):
        self.assertEqual(g.child_cardinality(SCHEMA,dict(parent='academic_years',child='instructional_calendars',fk='id')),'0..1')

    def test_composite_snapshot_fk_has_a_unique_subset(self):
        self.assertEqual(g.child_cardinality(SCHEMA,dict(parent='attendance_month_snapshots',child='attendance_months',fk='snapshot_id')),'0..1')

    def test_partial_binding_unique_index_does_not_erase_history(self):
        self.assertEqual(g.child_cardinality(SCHEMA,dict(parent='section_subjects',child='assessment_policy_bindings',fk='offering_id')),'0..N')

    def test_unique_superset_does_not_make_task_one_to_one(self):
        self.assertEqual(g.child_cardinality(SCHEMA,dict(parent='assessment_tasks',child='assessment_scores',fk='task_id')),'0..N')

    def test_self_reference_remains_many(self):
        self.assertEqual(g.child_cardinality(SCHEMA,dict(parent='learners',child='learners',fk='merged_into')),'0..N')

    def test_wrapping_preserves_every_underscore(self):
        for name in ['assessment_policy_drafts','assessment_policy_adoptions','assessment_policy_bindings','instructional_calendars','attendance_followups','attendance_month_snapshots']:
            lines=g.heading(name)
            self.assertEqual(''.join(lines),name.upper())
            self.assertTrue(all(line.endswith('_') for line in lines[:-1]))

    def test_overlapping_and_close_parallel_segments_are_rejected(self):
        base=((10,0),(10,100))
        self.assertTrue(g.too_close(base,((10,20),(10,120))))
        self.assertTrue(g.too_close(base,((18,20),(18,120))))
        self.assertFalse(g.too_close(base,((19,20),(19,120))))
        self.assertFalse(g.too_close(base,((0,50),(100,50))))

    def test_crossing_uses_interior_intersection(self):
        self.assertEqual(g.crossing(((0,50),(100,50)),((60,0),(60,100))),(60,50))
        self.assertIsNone(g.crossing(((0,50),(60,50)),((60,0),(60,100))))

    def test_no_font_is_smaller_than_eight_printed_points(self):
        self.assertGreaterEqual(min(g.BODY,g.SMALL,g.TITLE)*g.SCALE,8)

    def test_cardinality_offset_is_seven_printed_points(self):
        self.assertGreaterEqual(g.OFFSET*g.SCALE,6)
        self.assertLessEqual(g.OFFSET*g.SCALE,8)

    def test_clearance_is_ten_printed_points(self):
        self.assertGreaterEqual(g.CLEAR*g.SCALE,10)
        self.assertGreaterEqual(g.GAP*g.SCALE,6)

    def test_labels_are_detected_as_obstacles(self):
        label=(20,20,45,32)
        self.assertTrue(g.seg_hits(((0,25),(70,25)),label))
        self.assertTrue(g.overlaps(label,(44,25,60,40)))
        self.assertFalse(g.overlaps(label,(45,20,60,40)))

if __name__=='__main__': unittest.main()
