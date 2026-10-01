const test = require('node:test');
const assert = require('node:assert/strict');
const { canStudentEdit, canStudentSave, needsTeacherFeedback } = require('../dist/utils/submissionPolicy');

test('submitted and reviewed work is locked to the student', () => {
  for (const status of ['submitted', 'graded', 'flagged']) {
    assert.equal(canStudentEdit(status), false);
    assert.equal(canStudentSave(status, 'draft'), false);
    assert.equal(canStudentSave(status, 'submitted'), false);
  }
});

test('drafts can save and submit; requested revisions can resubmit', () => {
  assert.equal(canStudentSave('draft', 'draft'), true);
  assert.equal(canStudentSave('draft', 'submitted'), true);
  assert.equal(canStudentSave('revision_requested'), true);
  assert.equal(canStudentSave('revision_requested', 'draft'), false);
  assert.equal(canStudentSave('revision_requested', 'submitted'), true);
});

test('adverse review actions need an explanation', () => {
  assert.equal(needsTeacherFeedback('flagged'), true);
  assert.equal(needsTeacherFeedback('revision_requested'), true);
  assert.equal(needsTeacherFeedback('graded'), false);
});
