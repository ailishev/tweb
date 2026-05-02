/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import type {CancellablePromise} from '@helpers/cancellablePromise';
import type {InputFile} from '@layer';
import type {AuthState} from '@types';
import LoginPage from '@/pages/loginPage';
import Page from '@/pages/page';
import blurActiveElement from '@helpers/dom/blurActiveElement';
import rootScope from '@lib/rootScope';
import InputField from '@components/inputField';
import PopupElement from '@components/popups';
import PopupAvatar from '@components/popups/avatar';
import replaceContent from '@helpers/dom/replaceContent';
import I18n, {i18n} from '@lib/langPack';
import wrapEmojiText from '@lib/richTextProcessor/wrapEmojiText';
import Button from '@components/button';
import {putPreloader} from '@components/putPreloader';
import Icon from '@components/icon';
import backendAuthApi from '@lib/backendAuthApi';

let authCode: AuthState.signUp['authCode'] = null;

const onFirstMount = async() => {
  const page = new LoginPage({
    className: 'page-signUp',
    withInputWrapper: true,
    titleLangKey: 'YourName',
    subtitleLangKey: 'Login.Register.Subtitle'
  });

  page.imageDiv.classList.add('avatar-edit');

  page.title.classList.add('fullName');

  const avatarPreview = document.createElement('canvas');
  avatarPreview.id = 'canvas-avatar';
  avatarPreview.className = 'avatar-edit-canvas';

  const addIco = Icon('cameraadd', 'avatar-edit-icon');
  page.imageDiv.append(avatarPreview, addIco);

  let uploadAvatar: () => CancellablePromise<InputFile>;
  page.imageDiv.addEventListener('click', () => {
    PopupElement.createPopup(PopupAvatar).open(avatarPreview, (_uploadAvatar) => {
      uploadAvatar = _uploadAvatar;
    });
  });

  const handleInput = (e: Event) => {
    const name = nameInputField.value || '';
    const lastName = lastNameInputField.value || '';

    const fullName = name || lastName ?
      (name + ' ' + lastName).trim() :
      '';

    if(fullName) replaceContent(page.title, wrapEmojiText(fullName));
    else replaceContent(page.title, i18n('YourName'));
  };

  const sendAvatar = () => new Promise<void>((resolve, reject) => {
    if(!uploadAvatar) {
      // console.log('User has not selected avatar');
      return resolve();
    }

    // console.log('invoking uploadFile...');
    uploadAvatar().then((inputFile) => {
      // console.log('uploaded smthn', inputFile);

      rootScope.managers.appProfileManager.uploadProfilePhoto(inputFile).then(resolve, reject);
    }, reject);
  });

  const nameInputField = new InputField({
    label: 'FirstName',
    maxLength: 70
  });

  const lastNameInputField = new InputField({
    label: 'LastName',
    maxLength: 64
  });

  const btnSignUp = Button('btn-primary btn-color-primary');
  const btnI18n = new I18n.IntlElement({key: 'StartMessaging'});
  btnSignUp.append(btnI18n.element);

  page.inputWrapper.append(nameInputField.container, lastNameInputField.container, btnSignUp);

  nameInputField.input.addEventListener('input', handleInput);
  lastNameInputField.input.addEventListener('input', handleInput);

  btnSignUp.addEventListener('click', function(this: typeof btnSignUp, e) {
    if(nameInputField.input.classList.contains('error') || lastNameInputField.input.classList.contains('error')) {
      return false;
    }

    if(!nameInputField.value.length) {
      nameInputField.input.classList.add('error');
      return false;
    }

    this.disabled = true;

    const name = nameInputField.value.trim();
    const lastName = lastNameInputField.value.trim();

    const params = {
      phone_number: authCode.phone_number,
      phone_code_hash: authCode.phone_code_hash,
      verify_token: (authCode as any).verify_token,
      first_name: name,
      last_name: lastName
    };

    btnI18n.update({key: 'PleaseWait'});
    const preloader = putPreloader(this);

    const otpCode = (() => {
      try {
        return sessionStorage.getItem('backend_last_otp_code') || '';
      } catch(err) {
        return '';
      }
    })();

    backendAuthApi.completeProfile({
      phone_number: authCode.phone_number,
      phone_code: otpCode,
      first_name: name,
      last_name: lastName
    })
    .then((result) => {
      if(!result.ok) {
        throw {type: result.error || 'REGISTER_FAILED'};
      }

      const data = result.data || {};
      if(data.token) {
        localStorage.setItem('db_token', data.token);
      }

      // Keep tweb IM (MTProto) out of the flow in backend mode.
      sendAvatar().finally(() => {
        location.reload();
      });
    }).catch((err) => {
      this.removeAttribute('disabled');
      preloader.remove();

      switch(err.type) {
        default:
          btnI18n.update({key: err.type});
          break;
      }
    });
  });

  blurActiveElement();
  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
};

const page = new Page('page-signUp', true, onFirstMount, (_authCode: typeof authCode) => {
  authCode = _authCode;

  rootScope.managers.appStateManager.pushToState('authState', {_: 'authStateSignUp', authCode: _authCode});
});

export default page;
