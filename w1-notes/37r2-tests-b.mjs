
// An answer from before the unreadable flag, or any span with no PR pane and
// no flags, still never reads "No destructive change.".
test('a span with no PR pane and no flags still says its changes are unknown', () => {
  const data = sampleData()
  data.session = { ...data.session, complete: false, pr: null, divergence: null, flags: [] }
  const texts = textsOf(dataNodes(data, { span: 'session', view: 'divergence', open: null }))
  assert.equal(texts.includes('No destructive change.'), false)
  assert.ok(texts.includes('The PR pane couldn\'t be read for this span, so its changes are unknown.'))
})
