import Dexie from 'dexie'
import { v4 as uuidv4 } from 'uuid'
import * as Automerge from 'automerge'

const _getNewTextDoc = () => {
  return Automerge.change(Automerge.init(), doc => {
    doc.text = new Automerge.Text()
    doc.text.insertAt(0, { insert: '\n' }) // all Quill docs must start with newline
  })
}

const _getChanges = (docId) => {
  const databaseName = docId + '_changes'

  return window.dexieDb.items
    .where('[databaseName+itemId]')
    .between(
      [databaseName, Dexie.minKey],
      [databaseName, Dexie.maxKey]
    )
    .toArray()
}

export const getDatabases = () => {
  return window.dexieDb.databases.toArray()
}

export const getDocName = async (docId) => {
  const result = await window.dexieDb.items.get({
    databaseName: docId + '_metadata',
    itemId: 'DocName'
  })
  return result && result.item
}

export const getChange = async (docId, itemId) => {
  const result = await window.dexieDb.items.get({
    databaseName: docId + '_changes',
    itemId
  })
  return result && result.item
}

export const loadDoc = async (docId) => {
  if (!docId) return null

  let currentDoc

  const changesApplied = {}

  // get the doc name and the Automerge changes stored in Dexie
  const [docName, items] = await Promise.all([
    getDocName(docId),
    _getChanges(docId)
  ])

  if (!docName) return null

  // apply the changes to local state
  const changes = []
  const changesForServer = []

  for (let i = 0; i < items.length; i++) {
    const { itemId, item } = items[i]
    changes.push(item)
    changesApplied[itemId] = true
    changesForServer.push({ itemId, item, databaseName: docId + '_changes' })
  }

  // TO-DO: apply changes inside a worker
  console.log('Freeze 0 - (Automerge takes a while to apply large changes https://github.com/automerge/automerge/issues/89)')
  currentDoc = Automerge.applyChanges(Automerge.init(), changes)
  console.log('Unfreeze 0')

  return {
    docName,
    currentDoc,
    changesApplied,
    changesForServer: [changesForServer],
  }
}

export const localTransaction = async ({ databaseName, itemId, item }) => {
  await window.dexieDb.transaction('rw', window.dexieDb.databases, window.dexieDb.items, async () => {
    await Promise.all([
      window.dexieDb.databases.put({ databaseName }),
      window.dexieDb.items.put({ databaseName, itemId, item }),
    ])
  })
}

export const createNewDoc = async () => {
  const docId = uuidv4()
  const docName = 'Untitled'

  const initChanges = Automerge.getAllChanges(_getNewTextDoc())
  const textDoc = initChanges[0]

  // store the doc locally inside ACID transactions
  await Promise.all([
    localTransaction({ databaseName: docId + '_metadata', itemId: 'DocName', item: docName }),
    localTransaction({ databaseName: docId + '_changes', itemId: 'TextDoc', item: textDoc }),
  ])

  return docId
}

export const initLocalData = () => {
  window.dexieDb = new Dexie('hush_docs_db')
  window.dexieDb.version(1).stores({
    // first = primary key, [] = compound index
    databases: 'databaseName',
    items: '[databaseName+itemId]&',
  })
}