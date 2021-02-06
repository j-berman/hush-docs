import React, { Component } from 'react'
import { string, func } from 'prop-types'
import userbase from 'userbase-js'
import { SESSION_LENGTH } from '../../config'
import './navBar.css'

class UserModal extends Component {
  constructor(props) {
    super(props)
    this.state = {
      username: this.props.user ? this.props.user.username : '',
      password: '',
      newPassword: '',
      error: undefined
    }
  }

  componentDidMount() {
    this._isMounted = true
  }

  componentWillUnmount() {
    this._isMounted = false
  }

  handleEditUsername = (e) => {
    e.preventDefault()
    this.setState({ username: e.target.value, error: undefined })
  }

  handleEditPassword = (e) => {
    e.preventDefault()
    this.setState({ password: e.target.value, error: undefined })
  }

  handleEditNewPassword = (e) => {
    e.preventDefault()
    this.setState({ newPassword: e.target.value, error: undefined })
  }

  handleSubmit = async (e, updateUserType) => {
    e.preventDefault()
    const { modalType } = this.props
    const { username, password, newPassword } = this.state

    this.setState({ loading: true, error: undefined })

    try {
      let user
      switch (modalType) {
        case 'SignUp': {
          user = await userbase.signUp({ username, password, rememberMe: 'local', sessionLength: SESSION_LENGTH, email: username })
          this.props.handleSetUser({ user })
          break
        }
        case 'SignIn': {
          user = await userbase.signIn({ username, password, rememberMe: 'local', sessionLength: SESSION_LENGTH })
          this.props.handleSetUser({ user })
          break
        }
        case 'UpdateUser': {
          if (updateUserType === 'email') await userbase.updateUser({ username, email: username })
          else if (updateUserType === 'password') await userbase.updateUser({ currentPassword: password, newPassword })
          else {
            try {
              await userbase.signOut()
            } catch {
              // swallow error
            }
            this.props.handleSetUser({ user: undefined })
          }
          break
        }
        default: {
          throw new Error('unknown modal type')
        }
      }
    } catch (e) {
      if (this._isMounted) this.setState({ loading: false, error: e.message })
    }
  }

  handleForgotPassword = async (e) => {
    e.preventDefault()
    const { username } = this.state

    this.setState({ loading: true, error: undefined })

    try {
      await userbase.forgotPassword({ username, deleteEndToEndEncryptedData: true })
      window.alert('Check your email!')

      if (this._isMounted) this.setState({ loading: false })
    } catch (e) {
      if (this._isMounted) this.setState({ loading: false, error: e.message })
    }
  }
  
  render() {
    const { modalType } = this.props
    const { username, loading, error } = this.state

    return (
      <div>
        <div className="modal-body">
          <form onSubmit={(e) => this.handleSubmit(e, 'email')}>
            <input
              style={{ borderBottom: '1px dotted', fontWeight: 'normal', width: '100%' }}
              className={'input-no-style' + (loading ? ' loading' : '')} 
              type='email'
              placeholder='Email'
              value={username}
              disabled={loading}
              onChange={this.handleEditUsername}
            />
            <div className="modal-spacer" />

            { modalType === 'UpdateUser' && 
              <div>
                <span className={loading ? 'loading' : 'hover-bold'} tabIndex={0} style={{ width: 'max-content' }}>
                  <input className='input-no-style' type='submit' value='Update email' />
                </span>
                <div className="modal-spacer" />
                <div className="modal-spacer" />
              </div>
            }
          </form>

          <form onSubmit={(e) => this.handleSubmit(e, 'password')}>
            <input
              style={{ borderBottom: '1px dotted', fontWeight: 'normal', width: '100%' }}
              className={'input-no-style' + (loading ? ' loading' : '')} 
              type='password'
              name='password'
              autoComplete={modalType === 'SignUp' ? 'new-password' : 'current-password'}
              placeholder={modalType !== 'UpdateUser' ? 'Password' : 'Current password'}
              disabled={loading}
              onChange={this.handleEditPassword}
            />

            { modalType === 'SignIn' && 
              <div style={{ marginTop: '10px', fontSize: '.9rem' }}>
                <span className={loading ? 'loading' : 'hover-bold'} tabIndex={0} style={{ width: 'max-content' }} onClick={this.handleForgotPassword}>
                  Forgot password?
                </span>
              </div>
            }

            { modalType ==='UpdateUser' &&
              <div>
              <div className="modal-spacer" />
              <input
                style={{ borderBottom: '1px dotted', fontWeight: 'normal', width: '100%' }}
                className={'input-no-style' + (loading ? ' loading' : '')} 
                type='password'
                name='newPassword'
                autoComplete='new-password'
                placeholder='New password'
                disabled={loading}
                onChange={this.handleEditNewPassword}
              />
              </div>
            }

            { modalType === 'UpdateUser' &&
              <div>
                <div className="modal-spacer" />
                <div>
                  <span className={loading ? 'loading' : 'hover-bold'} tabIndex={0} style={{ width: 'max-content' }}>
                    <input className='input-no-style' type='submit' value='Change password' />
                  </span>
                  <div className="modal-spacer" />
                </div>
              </div>
            }
          </form>

          <div className="modal-spacer" />

          { error && <div>
              <div className='error'>{error}</div>
              <div className="modal-spacer" />
            </div>
          }

          { modalType === 'SignUp' && 
            <span>
            <strong>Warning: </strong>
              We strongly recommend using a <a href='https://bitwarden.com/products/' target='_blank' rel='noopener noreferrer'>password manager</a>.
              If you lose your device and forget your password, <strong>you can lose your docs</strong>.
            <div className="modal-spacer" />
            </span>
          }

          <div className="modal-spacer" />
          <div style={{ textAlign: 'center', marginTop: '-10px' }}>
            <span className={loading ? 'loading' : 'hover-bold'} tabIndex={0} style={{ width: 'max-content' }} onClick={this.handleSubmit}>
              { modalType === 'SignUp' && 'Create account' }
              { modalType === 'SignIn' && 'Sign in' }
              { modalType === 'UpdateUser' && 'Sign out'}
            </span>
          </div>
          <div className="modal-spacer" />
          <div className="modal-spacer" />
        </div>
      </div>
    )
  }
}

UserModal.propTypes = {
  modalType: string,
  handleSetUser: func,
}

export default UserModal