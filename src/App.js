import React, { Component } from 'react'
import userbase from 'userbase-js'
import { 
  USERBASE_APP_ID, 
  SESSION_LENGTH 
} from './config'
import {
  initLocalData
} from './dexie'
import NavBar from './components/navBar/navBar'
import HushDoc from './components/doc/doc'
import Dashboard from './components/dashboard/dashboard'

class App extends Component {
  constructor(props) {
    super(props)

    this.state = {
      mode: undefined,
      user: undefined,
    }
  }

  async componentDidMount() {
    window.addEventListener('hashchange', this.handleReadHash, false)

    try {
      initLocalData()
      this.handleReadHash()

      const { user } = await userbase.init({ 
        appId: USERBASE_APP_ID,
        sessionLength: SESSION_LENGTH,
        updateUserHandler: this.handleSetUser 
      })
      if (user) this.setState({ user })

    } catch (e) {
      try {
        await userbase.signOut()
      } catch (err) {
        // swallow error
      }
    }
  }

  handleSetUser = (userResult) => {
    const { user } = userResult
    this.setState({ user })
  }

  handleReadHash = async () => {
    const hashRoute = window.location.hash.substring(1)

    switch (hashRoute) {
      case 'dashboard': {
        this.setState({ mode: 'dashboard' })
        break
      }

      default: {
        const openSavedDocument = hashRoute.substring(0, 'doc='.length) === 'doc='
        const openSharedDocument = hashRoute.substring(0, 'share='.length) === 'share='

        const docId = openSavedDocument && hashRoute.substring('doc='.length)
        const shareToken = openSharedDocument && hashRoute.substring('share='.length)

        if (docId) {
          this.setState({ mode: 'doc', docId })
        }  else if (shareToken) {
          // must be signed in to access shared database via share token
          const { user } = await userbase.init({ 
            appId: USERBASE_APP_ID,
            sessionLength: SESSION_LENGTH,
            updateUserHandler: this.handleSetUser 
          })

          this.setState({ mode: 'doc', shareToken, user })
        } else {
          window.location.hash = 'dashboard'
        }
      }
    }
  }

  render() {
    const {
      mode,
      user,
      docId,
      shareToken,
    } = this.state

    const loading = mode === undefined

    return (
      <div>
        { loading &&
          <div className='centered' style={{ top: '40%', width: '40%' }}>Loading...</div>
        }

        <NavBar
          key={'NavBar' + mode + JSON.stringify(user)} // re-renders on mode or user change
          mode={mode}
          user={user}
          handleSetUser={this.handleSetUser}
        />

        { mode && (() => {
          switch (mode) {
            case 'doc':
              return <HushDoc 
                key={docId + (user && user.userId)}
                docId={docId}
                shareToken={shareToken}
                user={user}
              />

            case 'dashboard':
              return <Dashboard 
                key={user && user.userId}
                user={user}
              />

            default:
              console.error('Unknown mode')
          }
        })()}
      </div>
    )
  }
}

export default App
