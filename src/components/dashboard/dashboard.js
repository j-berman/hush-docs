import React, { Component } from 'react'
import userbase from 'userbase-js'
import './dashboard.css'
import {
  createNewDoc,
  getDatabases,
  getDocName,
  localTransaction,
} from '../../dexie'
import { UUID_LENGTH } from '../../config'

export default class Dashboard extends Component {
  constructor(props) {
    super(props)

    this.state = {
      docIds: undefined,
      docNames: undefined
    }
  }

  async componentDidMount() {
    this._isMounted = true

    const localDatabases = await getDatabases()
    const localDatabasesByDocId = {}

    const docIds = []
    const docNamePromises = []
    for (let i = 0; i < localDatabases.length; i++) {
      const { databaseName } = localDatabases[i]

      if (databaseName.substring(UUID_LENGTH) === '_metadata') {
        const docId = databaseName.substring(0, UUID_LENGTH)
        docIds.push(docId)
        docNamePromises.push(getDocName(docId))
        localDatabasesByDocId[docId] = true
      }

    }
    const docNames = await Promise.all(docNamePromises)

    if (this._isMounted) {
      this.setState({ docIds, docNames })

      // if signed in, get databases from server and add any extras to DexieDB if not already present
      if (this.props.user) {
        try {
          const { databases } = await userbase.getDatabases()
          for (let i = 0; i < databases.length; i++) {
            const { databaseName } = databases[i]

            if (databaseName.substring(UUID_LENGTH) === '_metadata') {
              userbase.openDatabase({ databaseName, changeHandler: (items) => this.metadataHandler(items, databaseName) })
            }
          }
        } catch (e) {
          // swallow
          console.warn(e)    
        }
      }
    }
  }

  componentWillUnmount() {
    this._isMounted = false
  }

  metadataHandler = (items, databaseName) => {
    if (this._isMounted) {
      if (items.length) {
        for (let i = 0; i < items.length; i++) {
          const { item, itemId } = items[i]
          if (itemId === 'DocName') {
            localTransaction({ databaseName, itemId, item })

            const docId = databaseName.substring(0, UUID_LENGTH)
            const { docIds, docNames } = this.state
            
            let foundDoc
            for (let j = 0; j < docIds.length && !foundDoc; j++) {
              foundDoc = docIds[j] === docId
              if (foundDoc) docNames[j] = item
            }

            if (!foundDoc) {
              docIds.push(docId)
              docNames.push(item)
            }

            this.setState({ docIds, docNames })
          }
        }
      }
    }
  }

  render() {
    const {
      docIds,
      docNames,
    } = this.state

    const loading = docIds === undefined

    return (
      <div id='docs-dashboard' className='dashboard-with-table max-screen-width'>
        { loading
          ? <div className='centered' style={{ top: '40%', width: '40%' }}>
            Loading...
          </div>
          : <div>
            <div className='dashboard-with-table-total'>{docIds.length} doc{docIds.length === 1 ? '' : 's'}</div>
            <div className='dashboard-with-table-outer-container'>
              <div className='container'>
                <table className='dashboard-table'>
                  {docIds.length > 0 &&
                    <tbody>
                      {docIds.map((docId, i) => <tr key={docId}>
                        <td className='docs-dashboard-row'>
                          <a href={'#doc=' + docId}>{docNames[i]}</a>
                        </td>
                      </tr>)}
                    </tbody>
                  }
                </table>

                {!docIds.length && <div className='create-doc-to-get-started'>
                  <span className='hover-bold' style={{ textDecoration: 'underline' }} onClick={createNewDoc}>Create a new document</span> to get started
                </div>}

              </div>
            </div>
          </div>
        }

      </div>
    )
  }
}
