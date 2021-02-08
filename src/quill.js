import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import Automerge from 'automerge'
import { v4 as uuidv4 } from 'uuid'
import { changeHandlerQueue } from './utils'
import { localTransaction } from './dexie'

// re-implemented to get this code to work safely for different combinations of formatting, but with worse space efficiency
// https://github.com/automerge/automerge/blob/main/test/text_test.js
function isEquivalent(a, b) {
  if (!a && !b) return true
  if ((a && !b) || (!a && b)) return false

  var aProps = Object.getOwnPropertyNames(a)
  var bProps = Object.getOwnPropertyNames(b)

  if (aProps.length !== bProps.length) {
      return false
  }

  for (var i = 0; i < aProps.length; i++) {
      var propName = aProps[i]
      if (a[propName] !== b[propName]) {
          return false
      }
  }

  return true
}

export function automergeTextToDeltaDoc(text) {
  const ops = []
  let currentString = ''

  const spans = text.toSpans()
  for (let i = 0; i < spans.length; i++) {
    const thisSpan = spans[i]
    const { attributes, insert } = thisSpan

    if (attributes && typeof attributes !== 'object') continue

    if (typeof insert === 'string') {
      currentString += insert

      const nextSpan = spans[i + 1]
      if (!nextSpan || typeof nextSpan.insert !== 'string' ||  !isEquivalent(thisSpan.attributes, nextSpan.attributes)) {
        ops.push({ insert: currentString, attributes  })
        currentString = ''
      }
    } else {
      const op = { insert }
      if (attributes) op.attributes = attributes
      ops.push(op)
    }
  }

  if (currentString) ops.push({ insert: currentString })

  return ops
}

function applyDeleteOp(doc, offset, op) {
  const length = op.delete + offset
  for (let i = offset; i < length; i++) {
    // each delete shrinks the size of the text, need to maintain the offset index for deletion
    doc.text.deleteAt(offset)
  }
  return offset
}

function applyRetainOp(doc, offset, op) {
  const length = op.retain + offset

  if (op.attributes) {
    for (let i = offset; i < length; i++) {
      const char = doc.text.get(i)
      const { insert, attributes } = char

      if (isEquivalent(attributes, op.attributes)) continue

      // embed objects don't need attributes applied
      if (typeof insert !== 'string') continue

      const newAttributes = {
        ...attributes,
        ...op.attributes
      }

      doc.text.deleteAt(i)
      doc.text.insertAt(i, { insert, attributes: newAttributes })
    }
  }

  return length
}

function applyInsertOp(doc, offset, op) {
  if (typeof op.insert === 'string') {
    const chars = op.insert.split('')
    for (let i = 0; i < chars.length; i++) {
      const insertObject = { insert: chars[i] }
      if (op.attributes) insertObject.attributes = op.attributes
      doc.text.insertAt(offset + i, insertObject)
    }
    offset += op.insert.length
  } else {
    // we have an embed or something similar
    doc.text.insertAt(offset, { insert: op.insert })
    offset += 1
  }

  return offset
}

function applyDeltaDocToAutomergeText(delta, doc) {
  let offset = 0
  delta.forEach(op => {
    if (op.retain) {
      offset = applyRetainOp(doc, offset, op)
    } else if (op.delete) {
      offset = applyDeleteOp(doc, offset, op)
    } else if (op.insert) {
      offset = applyInsertOp(doc, offset, op)
    }
  })
}

const DEFAULT_PLACEHOLER = `Welcome to Hush Docs!

Please read everything below:

    * No one but you and people you share your docs with has access to your docs. Not even the people behind Hush Docs!

    * You can visit hushdocs.com and create docs even when you have no internet connection. Docs save on your device automatically.

    * If you want to access your docs from another device, or collaborate with others on a doc, you can create an account.

    * Please be aware: if someone evil gets physical access to your computer or takes control of hushdocs.com, they can access your docs!

    * Keep in mind this is a demo app subject to change in the future. You can download your docs at any time.

Just start typing in here to get started!
`

const newQuill = () => {
  var Font = Quill.import('formats/font')
  Font.whitelist = [
    'Consolas',
    'Monospace',
    'Times-New-Roman',
    'Impact',
    'Luminari',
    'Cursive',
    'Bradley-Hand',
    'Brush-Script-MT'
  ]
  Quill.register(Font, true)

  const Size = Quill.import('formats/size')
  Size.whitelist = ["small", "normal", "large", "huge"]
  Quill.register(Size, true)

  return new Quill('#editor', {
    modules: {
      toolbar: '#toolbar'
    },
    theme: 'snow',
    placeholder: DEFAULT_PLACEHOLER,
  })
}

export const initQuill = (that) => {
  const quill = newQuill()

  const deltaDoc = automergeTextToDeltaDoc(that.currentDoc.text)
  quill.setContents(deltaDoc)

  quill.on('text-change', async function(delta, _, source) {
    if (source !== 'user') return

    // the queue guarantees change handlers will be executed one at a time
    if (changeHandlerQueue.isEmpty()) {

      // take a spot in the queue and proceed executing so the next caller knows queue is not empty
      changeHandlerQueue.enqueue(null)
    } else {

      // wait until prior changeHandler in queue finishes executing successfully
      await new Promise(resolve => {
        const startNextChangeHandler = resolve
        changeHandlerQueue.enqueue(startNextChangeHandler)
      })
    }

    const { docId } = that.props
    const { currentDoc } = that

    // TO-DO: get newDoc inside a worker, start loader next to document name
    const newDoc = Automerge.change(currentDoc, doc => {
      applyDeltaDocToAutomergeText(delta, doc)
      console.log('Freezing 1 (Automerge takes a while to apply large changes https://github.com/automerge/automerge/issues/89)')
    })
    console.log('Unfreeze 1')

    const changes = Automerge.getChanges(currentDoc, newDoc)
      .map(change => (that.setDatabaseReference('_changes', { itemId: uuidv4(), item: change })))

    changes.forEach((change) => {
      that.changesApplied[change.itemId] = true
      if (docId) localTransaction(change)
    })

    that.currentDoc = newDoc
    that.changesForServer.push(changes)

    changeHandlerQueue.dequeue()
    if (!changeHandlerQueue.isEmpty()) {
      const startNextChangeHandler = changeHandlerQueue.peek()
      startNextChangeHandler()
    }
  })

  that.quill = quill
}
