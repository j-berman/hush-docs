import React, { Component } from 'react'
import { string, object, func } from 'prop-types'
import './navBar.css'
import UserModal from './userModal'

class NavBar extends Component {
  constructor(props) {
    super(props)
    this.state = {
      modalOpen: false,
      modalType: undefined,
    }

    this.menuWrapperRef = React.createRef()
    this.modalRef = React.createRef()
  }

  async componentDidMount() {
    document.addEventListener('mousedown', this.handleClickOutsideModal)
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleClickOutsideModal)
  }

  // https://stackoverflow.com/questions/32553158/detect-click-outside-react-component
  handleClickOutsideModal = (e) => {
    const { modalOpen } = this.state
    if (!modalOpen) return
    if (this.modalRef && !this.modalRef.current.contains(e.target)) {
      this.setState({ modalOpen: false })
    }
  }

  handleToggleMenu = () => {
    this.setState(state => ({ profileMenuOpen: !state.profileMenuOpen }))
  }

  handleOpenModal = (modalType) => {
    this.setState({ modalOpen: true, modalType })
  }

  handleCloseModal = () => {
    this.setState({ modalOpen: false })
  }

  render() {
    const { mode, user } = this.props
    const { modalOpen, modalType } = this.state

    return (
      <div>
      <div id='topnav' className='topnav-container fixed'>
        <ul className='topnav'>
          <li className='desktop-topnav-item'><h1 className='topnav-item'  style={{ paddingLeft: 0 }}>Hush Docs</h1></li>

          { mode !== 'dashboard' && <li className='desktop-topnav-item'><a className='topnav-item' href='#dashboard'>{'< All docs'}</a></li>}

          <li className='desktop-topnav-item'><a className='topnav-item' href='#new-doc'>{'New document'}</a></li>

          { !user
            ? <React.Fragment>
                <li className='desktop-topnav-item' style={{ marginLeft: 'auto' }}>
                  <span className='topnav-item hover-bold' onClick={() => this.handleOpenModal('SignIn')}>Sign in</span>
                </li>
                <li className='desktop-topnav-item'>
                  <span className='topnav-item hover-bold' onClick={() => this.handleOpenModal('SignUp')}>New account</span>
                </li>
              </React.Fragment>
            : <React.Fragment>
                <li className='desktop-topnav-item' style={{ marginLeft: 'auto' }}>
                  <span className='topnav-item hover-bold' onClick={() => this.handleOpenModal('UpdateUser')}>{user.username}</span>
                </li>
              </React.Fragment>
          }
          
        </ul>
        </div>

        { modalOpen &&  
          <div className="modal-wrapper">
            <div className="modal-content" ref={this.modalRef}>
              <div className="modal-close">
                <span className="hover-bold" onClick={this.handleCloseModal}>&times;</span>
              </div>  
              <UserModal modalType={modalType} handleSetUser={this.props.handleSetUser} user={user} />
            </div>
           </div>
        }

      </div>
    )
  }
}

NavBar.propTypes = {
  mode: string,
  user: object,
  handleSetUser: func,
}

export default NavBar