import React, { Component } from 'react'
import { string, object } from 'prop-types'
import LZString from 'lz-string'
import htmlDocx from 'html-docx-js/dist/html-docx'
import $ from 'jquery'
import 'quill/dist/quill.snow.css'
import Automerge from 'automerge'
import userbase from 'userbase-js'
import './doc.css'
import { 
  loadDoc,
  getChange,
  localTransaction,
} from '../../dexie'
import { 
  initQuill,
  automergeTextToDeltaDoc,
} from '../../quill'
import {
  downloadFileLocally,
  makeCssInline,
  changeHandlerQueue,
} from '../../utils'

const TEN_KB = 10 * 1024

class Doc extends Component {
  constructor(props) {
    super(props)

    this.state = {
      docName: undefined,
      editTitle: false,
      sharing: false,
      loadingDoc: true,
    }

    this.changesApplied = undefined
    this.changesForServer = []
    this.changesStoredOnServer = {}
    this.interval = undefined
    this.changeDatabaseOpened = false
    this.metadataDatabaseOpened = false

    this.titleWrapperRef = React.createRef()
  }

  async componentDidMount() {
    const { 
      docId,        // either docId provided
      shareToken,   // or shareToken is provided
      user,         // only provided when user is signed in
    } = this.props

    this._isMounted = true
    document.addEventListener('mousedown', this.handleSaveDocName)
    document.addEventListener('keydown', this.handleSaveDocName)

    if (shareToken && !user) {
      window.alert('Create an account or sign in to view the doc!')
      return
    }

    const localDoc = await loadDoc(docId)
    if (docId && !localDoc) {
      // if docId provided, user is expected to have access to database locally
      window.location.hash = 'dashboard'
      return
    }

    if (this._isMounted) {
      this.intervalToPushServerChanges = setInterval(() => {
        if (this._isMounted && this.changeDatabaseOpened && this.metadataDatabaseOpened) {
          // by here, we know that the databases have synced with the server since the server must have
          // finished applying first round of changes
          this.pushServerChanges()
        }
      }, 1000)

      if (docId) {
        const {
          docName,
          currentDoc,
        } = localDoc
  
        this.currentDoc = currentDoc
        this.setState({ docName })
      }

      this.changesApplied = (docId && localDoc.changesApplied) || []
      this.changesForServer = (docId && localDoc.changesForServer) || []

      // need to load text doc from server if no text doc is present locally.
      // must wait until it's loaded in its entirety, files and all
      if (!localDoc || !localDoc.currentDoc.text) {
        
        // retrieve the respective share tokens
        if (shareToken) {
          await this.openDatabase({ shareToken, changeHandler: (items) => {
            for (let i = 0; i < items.length; i++) {
              const { item } = items[i]
              if (item.changesShareToken) this.changesShareToken = item.changesShareToken
              else if (item.metadataShareToken) this.metadataShareToken = item.metadataShareToken
            }
          }})
        }

        let databaseFinishedLoading
        const waitForDatabaseToLoad = new Promise((resolve) => databaseFinishedLoading = resolve )
        this.databaseFinishedLoading = databaseFinishedLoading

        await Promise.all([
          this.openDatabase(this.setDatabaseReference('_changes', { changeHandler: this.changeHandler })),
          this.openDatabase(this.setDatabaseReference('_metadata', { changeHandler: this.metadataHandler })),
        ])
        await waitForDatabaseToLoad

      } else if (this.props.user) {
        // no need to wait for these to finish, user can start messing with document right away
        this.openDatabase({ databaseName: docId + '_changes', changeHandler: this.changeHandler })
        this.openDatabase({ databaseName: docId + '_metadata', changeHandler: this.metadataHandler })
      }
      
      initQuill(this)
      this.setState({ loadingDoc: false })
    }
  }

  componentWillUnmount() {
    this._isMounted = false
    document.removeEventListener('mousedown', this.handleClickOutsideTitleEditor)
    document.removeEventListener('keydown', this.handleSaveDocName)

    if (this.intervalToPushServerChanges) clearInterval(this.intervalToPushServerChanges)
  }

  setDatabaseReference = (suffix, otherParams) => {
    const {
      docId,
      shareToken,
    } = this.props

    const params = { ...otherParams }

    if (shareToken) {
      if (suffix === '_changes') params.shareToken = this.changesShareToken
      else if (suffix === '_metadata') params.shareToken = this.metadataShareToken

    } else {
      params.databaseName = docId + suffix
    }

    return params
  }

  pushServerChanges = () => {
    const {
      changesForServer,
      changesStoredOnServer,
    } = this

    const operations = {}

    for (let i = 0; i < changesForServer.length; i++) {
      const changes = changesForServer[i]

      for (let j = 0; j < changes.length; j++) {
        const { databaseName, shareToken, itemId, item, command } = changes[j]
        const opReference = databaseName || shareToken // mutually exclusive

        if (itemId === 'DocName') {
          if (!operations[opReference]) {
            operations[opReference] = { operations: [] }
            if (databaseName) operations[opReference].databaseName = databaseName
            else operations[opReference].shareToken = shareToken
          }

          operations[opReference].operations.push({
            command: command || 'Insert',
            item,
            itemId,
            writeAccess: { onlyCreator: true }
          })

        } else if (!changesStoredOnServer[itemId]) {
          // don't need to try to store it again if already stored on server

          // compress the Automerge change
          const compressed = LZString.compress(JSON.stringify(item))

          if (compressed.length * 2 < TEN_KB) {
            if (!operations[opReference]) {
              operations[opReference] = { operations: [] }
              if (databaseName) operations[opReference].databaseName = databaseName
              else operations[opReference].shareToken = shareToken
            }

            operations[opReference].operations.push({
              command: command || 'Insert',
              item: { compressed },
              itemId,
              writeAccess: { onlyCreator: true }
            })

          } else {
            this.uploadAsFile(databaseName, shareToken, itemId, item)
          }
  
          // 10 operations allowed in a transaction
          if (operations[opReference] && operations[opReference].operations.length === 10) {
            // don't need to wait, Automerge will handle out-of-order conflict resolution
            this.putTransaction(operations[opReference])
            operations[opReference].operations = []
          }
        }    
      }
    }

    const opReferences = Object.keys(operations)
    if (opReferences.length) {
      for (let i = 0; i < opReferences.length; i++) {
        const opReference = opReferences[i]
        if (operations[opReference].operations.length) this.putTransaction(operations[opReference])
      }
    }

    this.changesForServer = []
  }

  changeHandler = async (items) => {
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
    
    const { docId } = this.props
    const { quill } = this

    // avoids race condition when change gets applied elsewhere
    const changesApplied = JSON.parse(JSON.stringify(this.changesApplied))

    if (items.length) {
      let currentDoc = this.currentDoc || Automerge.init()

      for (let i = 0; i < items.length; i++) {
        const { itemId, item, fileId, writeAccess } = items[i]

        this.changesStoredOnServer[itemId] = true
        if (changesApplied[itemId]) continue // no need to re-apply

        if (writeAccess && writeAccess.onlyCreator) {
          try {
            if (item.compressed) {

              const change = JSON.parse(LZString.decompress(item.compressed))
              currentDoc = Automerge.applyChanges(currentDoc, [change])
              changesApplied[itemId] = true
              if (docId) localTransaction({ databaseName: docId + '_changes', itemId, item: change })

            } else if (item.storedAsFile && fileId) {
              const localCopy = docId && await getChange(docId, itemId)

              let change
              if (!localCopy) {
                const { file } = await userbase.getFile(this.setDatabaseReference('_changes', { fileId }))
                const recompressed = await file.arrayBuffer()
                change = JSON.parse(LZString.decompressFromUint8Array(new Uint8Array(recompressed)))
                if (docId) localTransaction({ databaseName: docId + '_changes', itemId, item: change })
              } else {
                change = localCopy
              }

              currentDoc = Automerge.applyChanges(currentDoc, [change])
              changesApplied[itemId] = true
            }
          } catch (e) {
            console.warn('swallowed', e)
          }
        }
      }

      // if loading doc from server, won't have initialized quill yet
      if (quill) {
        const deltaDoc = automergeTextToDeltaDoc(currentDoc.text)
        const range = quill.getSelection()
        quill.setContents(deltaDoc)
        quill.setSelection(range)
      }

      if (this._isMounted) {
        this.quill = quill
        this.currentDoc = currentDoc
        this.changesApplied = changesApplied

        if (this.databaseFinishedLoading) this.databaseFinishedLoading()
      }
    }

    this.changeDatabaseOpened = true

    changeHandlerQueue.dequeue()
    if (!changeHandlerQueue.isEmpty()) {
      const startNextChangeHandler = changeHandlerQueue.peek()
      startNextChangeHandler()
    }
  }

  metadataHandler = (items) => {
    const { docId } = this.props
    const { docName } = this.state 
    const { changesForServer } = this

    if (this._isMounted) {
      if (items.length) {
        for (let i = 0; i < items.length; i++) {
          const { item, itemId } = items[i]

          if (itemId === 'DocName') {
            this.setState({ docName: item  })

            if (docId) localTransaction({ databaseName: docId + '_metadata', itemId, item })
            this.metadataDatabaseOpened = true
          }
        }
      } else {
        const changeForServer = this.setDatabaseReference('_metadata', { itemId: 'DocName', item: docName, command: 'Insert' }) 
        changesForServer.push([changeForServer])
        this.changesForServer = changesForServer
        this.metadataDatabaseOpened = true
      }
    }
  }

  openDatabase = async (params) => {
    try {
      await userbase.openDatabase(params)
    } catch {
      setTimeout(() => this.openDatabase(params), 3000)
    }
  }

  putTransaction = async (params) => {
    try {
      await userbase.putTransaction(params)
    } catch (e) {
      // keep retrying if server failure, or need to sign in/open database. duplicates ok to fail
      if (e.status >= 500 || e.name === 'UserNotSignedIn' || e.name === 'DatabaseNotOpen') {
        setTimeout(() => this.putTransaction(params), 3000)
      }
    }
  }

  uploadAsFile = (databaseName, shareToken, itemId, item) => {
    const recompressedForFile = LZString.compressToUint8Array(JSON.stringify(item))
    const fileName = itemId + '.txt'
    const file = new File([recompressedForFile], fileName)

    const databaseReference = {}
    if (databaseName) databaseReference.databaseName = databaseName
    else databaseReference.shareToken = shareToken

    const itemParams = { ...databaseReference, item: { storedAsFile: true }, itemId, writeAccess: { onlyCreator: true } }
    const fileParams = { ...databaseReference, file, itemId }

    this.insertItemThenUpload(itemParams, fileParams)
  }

  insertItemThenUpload = async (itemParams, fileParams) => {
    try {
      await userbase.insertItem(itemParams)
      this.uploadFile(fileParams)
    } catch (e) {
      // keep retrying if server failure, or need to sign in/open database. duplicates ok to fail
      if (e.status >= 500 || e.name === 'UserNotSignedIn' || e.name === 'DatabaseNotOpen') {
        setTimeout(() => this.insertItemThenUpload(itemParams), 3000)
      } else {
        this.uploadFile(fileParams) // so long as item exists, the file is immutable, so be 100% sure it stores
      }
    }
  }

  uploadFile = async (params) => {
    try {
      await userbase.uploadFile(params)
    } catch (e) {
      // keep retrying if server failure, or need to sign in/open database. duplicates ok to fail
      if (e.status >= 500 || e.name === 'UserNotSignedIn' || e.name === 'DatabaseNotOpen') {
        setTimeout(() => this.uploadFile(params), 3000)
      }
    }
  }

  handleOpenTitleEditor = () => {
    this.setState({ editingTitle: true })
  }

  // https://stackoverflow.com/questions/32553158/detect-click-outside-react-component
  handleSaveDocName = (e) => {
    const {
      docId,
    } = this.props
    const {
      editingTitle,
      docName,
    } = this.state

    if (!editingTitle) return
    if (!docName) return

    const clickedOutsideTitleEditor = this.titleWrapperRef && !this.titleWrapperRef.current.contains(e.target)

    const ENTER_KEY_CODE = 13
    const clickedEnter = e.key === 'Enter' || e.keyCode === ENTER_KEY_CODE

    if (clickedOutsideTitleEditor || clickedEnter) {
      const change = this.setDatabaseReference('_metadata', { itemId: 'DocName', item: docName, command: 'Update' })
      this.setState({ editingTitle: false })
      
      if (docId) localTransaction(change)
      this.changesForServer.push([change]) 
    }
  }

  handleEditDocumentTitle = (e) => {
    this.setState({ docName: e.target.value })
  }

  handleDownloadDoc = () => {
    const { docName } = this.state

    // https://github.com/quilljs/quill/issues/1996
    let html = '<html><head><meta charset="UTF-8"></head><body>'

    const jQueryQuillEditor = $('#editor').find('.ql-editor').clone()

    // all CSS will be set inline so that it will print in document
    makeCssInline(jQueryQuillEditor)
    html += jQueryQuillEditor.html()

    html += '</body></html>'

    const file = htmlDocx.asBlob(html)
    file.name = docName + '.docx'

    downloadFileLocally(file)
  }

  displayShareTokenLink = (shareToken) => {
    const replacedEscapeCharacters = shareToken.replace(/\\/g,"\\\\")
    window.prompt(`Share this link to collaborate on this doc:`, `${window.location.origin}#share=${replacedEscapeCharacters}`)
  }

  handleShareDoc = async (e) => {
    e.preventDefault()
    
    const { docId, user } = this.props
    const { sharing } = this.state
    if (sharing || !user) return

    if (this.props.shareToken) {
      this.displayShareTokenLink(this.props.shareToken)
      return
    }

    this.setState({ sharing: true })

    try {
      let shareToken
      const allShareTokensChangeHandler = (items) => {
        const shareTokenItem = items.find(({ itemId }) => itemId === docId)
        if (shareTokenItem) shareToken = shareTokenItem.item.shareToken
      }

      // open all databases needed to share document
      await Promise.all([
        userbase.openDatabase({ databaseName: 'all-share-tokens', changeHandler: allShareTokensChangeHandler }),
        userbase.openDatabase({ databaseName: docId + '_share-tokens', changeHandler: () => {} }),
      ])

      if (shareToken) {
        this.displayShareTokenLink(shareToken)
      } else {
        const [changesShareTokenResult, metadataShareTokenResult, shareTokenResult] = await Promise.all([
          userbase.shareDatabase({ databaseName: docId + '_changes', readOnly: false }),
          userbase.shareDatabase({ databaseName: docId + '_metadata', readOnly: false }),
          userbase.shareDatabase({ databaseName: docId + '_share-tokens', readOnly: false }),
        ])

        const changesShareToken = changesShareTokenResult.shareToken
        const metadataShareToken = metadataShareTokenResult.shareToken
        shareToken = shareTokenResult.shareToken

        try {
          await Promise.all([
            userbase.insertItem({ databaseName: 'all-share-tokens', itemId: docId, item: { shareToken } }),
            userbase.putTransaction({ databaseName: docId + '_share-tokens', operations: [
              { command: 'Insert', itemId: docId + '_changes', item: { changesShareToken } },
              { command: 'Insert', itemId: docId + '_metadata', item: { metadataShareToken } },
            ]})
          ])
        } catch {
          await Promise.all([
            userbase.updateItem({ databaseName: 'all-share-tokens', itemId: docId, item: { shareToken } }),
            userbase.putTransaction({ databaseName: docId + '_share-tokens', operations: [
              { command: 'Update', itemId: docId + '_changes', item: { changesShareToken } },
              { command: 'Update', itemId: docId + '_metadata', item: { metadataShareToken } },
            ]})
          ])
        }

        this.displayShareTokenLink(shareToken)
      }

    } catch (e) {
      window.alert('There was an issue sharing! Please try again.\n\nError: ' + e.message)
    }

    if (this._isMounted) this.setState({ sharing: false })
  }

  render() {
    const { user, docId } = this.props
    const {
      docName,
      editingTitle,
      sharing,
      loadingDoc,
    } = this.state

    const loading = docName === undefined

    return (
      <div id='doc' >
        { (loading || loadingDoc) &&
          <div className='centered' style={{ top: '40%', width: '40%' }}>
            Loading...
          </div>
        }

        <div className='topnav-container fixed'>
          <ul className='topnav max-screen-width'>
            {!loading && <li className='desktop-topnav-item'>
              { docId
                ?  <span className='topnav-item hover-bold' style={{ paddingLeft: 0 }} ref={this.titleWrapperRef} onClick={this.handleOpenTitleEditor}>
                  {editingTitle
                    ? <input
                      style={{ textAlign: 'left', borderBottom: '1px dotted', fontWeight: 'normal', width: '350px', cursor: 'text' }}
                      className='input-no-style'
                      type='text'
                      onChange={this.handleEditDocumentTitle}
                      value={docName}
                    />
                    : <span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '350px', display: 'inline-block', verticalAlign: 'top', cursor: 'text' }}>{docName}</span>
                      <span style={{ color: 'grey', fontWeight: 'normal', cursor: 'pointer', paddingLeft: '5px' }}>{'  <edit>'}</span>
                    </span>
                    }
                  </span>
                : <span className='topnav-item' style={{ paddingLeft: 0 }}>{docName}</span>  
              }
            </li>}
            <li className='desktop-topnav-item' style={{ marginLeft: 'auto' }}>
              <span className='topnav-item hover-bold' onClick={this.handleDownloadDoc}>Download</span>
            </li>
            <li className='desktop-topnav-item'>
              <span className={'topnav-item ' + ((user && !sharing) ? 'hover-bold' : 'disabled')} onClick={this.handleShareDoc}>
                Share
              </span>
            </li>

          </ul>
        </div>

        <div id='quill-container' className='max-screen-width' style={{ display: loadingDoc ? 'none' : 'block' }}>
          <div id="toolbar">
            <div className="ql-toolbar ql-snow">
              <span className="ql-formats">
                <select className="ql-font" defaultValue="Sans Serif">
                  <option value="Sans Serif">Sans Serif</option>
                  <option value="Consolas">Consolas</option>
                  <option value="Monospace">Monospace</option>
                  <option value="Times-New-Roman">Times New Roman</option>
                  <option value="Impact">Impact</option>
                  <option value="Luminari">Luminari</option>
                  <option value="Cursive">Cursive</option>
                  <option value="Bradley-Hand">Bradley Hand</option>
                  <option value="Brush-Script-MT">Brush Script MT</option>
                </select>
                <select defaultValue="normal" className="ql-size" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-bold" />
                <button type="button" className="ql-italic" />
                <button type="button" className="ql-underline" />
                <button type="button" className="ql-strike" />
              </span>

              <span className="ql-formats">
                <select className="ql-color" />
                <select className="ql-background" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-script" value="super" />
                <button type="button" className="ql-script" value="sub" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-header" value="1" />
                <button type="button" className="ql-header" value="2" />
                <button type="button" className="ql-blockquote" />
                <button type="button" className="ql-code-block" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-list" value="ordered" />
                <button type="button" className="ql-list" value="bullet" />
                <button type="button" className="ql-indent" value="-1" />
                <button type="button" className="ql-indent" value="+1" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-direction" value="rtl" />
                <select className="ql-align" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-link" />
                <button type="button" className="ql-image" />
                <button type="button" className="ql-video" />
                <button type="button" className="ql-formula" />
              </span>

              <span className="ql-formats">
                <button type="button" className="ql-clean" />
              </span>
            </div>
          </div>

          <div id='editor'>
          </div>

          <div style={{ textAlign: 'center', paddingTop: '30px', paddingBottom: '30px', fontSize: 'small' }}>
            This website is <a href='https://github.com/j-berman/hushdocs' target='_blank' rel='noopener noreferrer'>open source</a>
          </div>
        </div>
        
      </div>
    )
  }
}

Doc.props = {
  docId: string,
  shareToken: string,
  user: object,
}

export default Doc
