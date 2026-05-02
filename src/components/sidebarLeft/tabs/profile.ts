/*
 * https://github.com/morethanwords/tweb
 * Copyright (C) 2019-2021 Eduard Kuzmenko
 * https://github.com/morethanwords/tweb/blob/master/LICENSE
 */

import {SliderSuperTab} from '@components/slider';
import rootScope from '@lib/rootScope';
import {createRoot} from 'solid-js';
import {renderPeerProfile} from '@components/peerProfile';
import SolidJSHotReloadGuardProvider from '@lib/solidjs/hotReloadGuardProvider';
import ButtonCorner from '@components/buttonCorner';
import {attachClickEvent} from '@helpers/dom/clickEvent';
import {getFileAndOpenEditor} from '@components/avatarEdit';
import appDownloadManager from '@lib/appDownloadManager';
import AppSettingsTab from '@components/sidebarLeft/tabs/settings';
import ButtonIcon from '@components/buttonIcon';
import SettingSection from '@components/settingSection';
import Row from '@components/row';
import AppSharedMediaTab from '@components/sidebarRight/tabs/sharedMedia';
import {AppNotificationsTab} from '@components/solidJsTabs';
import AppDataAndStorageTab from '@components/sidebarLeft/tabs/dataAndStorage';
import AppPrivacyAndSecurityTab from '@components/sidebarLeft/tabs/privacyAndSecurity';
import AppGeneralSettingsTab from '@components/sidebarLeft/tabs/generalSettings';
import AppChatFoldersTab from '@components/sidebarLeft/tabs/chatFolders';
import AppStickersAndEmojiTab from '@components/sidebarLeft/tabs/stickersAndEmoji';
import AppActiveSessionsTab from '@components/sidebarLeft/tabs/activeSessions';
import backendBootstrapStore from '@stores/backendBootstrapStore';
import {reconcilePeer} from '@stores/peers';
import {mapBackendUser} from '@lib/backendMtprotoAdapter';
import backendApi from '@lib/backendApi';

export default class AppProfileTab extends SliderSuperTab {
  public async init() {
    this.container.classList.add('settings-container');
    this.setTitle('Profile');

    const settingsBtn = ButtonIcon('settings');
    this.header.append(settingsBtn);
    attachClickEvent(settingsBtn, () => {
      this.slider.createTab(AppSettingsTab).open();
    }, {listenerSetter: this.listenerSetter});

    const changeAvatarBtn = ButtonCorner({icon: 'cameraadd', className: 'profile-change-avatar'});
    attachClickEvent(changeAvatarBtn, () => {
      getFileAndOpenEditor({
        dontCreatePreview: true,
        onFinish: async(editorResult) => {
          if(editorResult.isVideo) return;
          const resultPayload = await editorResult.getResult();
          const inputFile = await appDownloadManager.upload(resultPayload.blob);
          this.managers.appProfileManager.uploadProfilePhoto(inputFile);
        }
      });
    }, {listenerSetter: this.listenerSetter});

    const peerProfileElement = createRoot((dispose) => {
      this.middlewareHelper.onDestroy(dispose);
      return renderPeerProfile({
        peerId: rootScope.myId,
        isDialog: false,
        scrollable: this.scrollable,
        setCollapsedOn: this.container,
        changeAvatarBtn
      }, SolidJSHotReloadGuardProvider);
    });

    // Ensure self peer is hydrated in UI store from freshest backend payload.
    // This keeps native PeerProfile blocks (name/username/status/avatar) rendered without custom UI.
    const meRes = await backendApi.me();
    if(meRes.ok && meRes.data && typeof meRes.data === 'object') {
      reconcilePeer(rootScope.myId, mapBackendUser(meRes.data, {self: true}) as any);
    } else if(backendBootstrapStore.currentUser?.id) {
      const meData = backendBootstrapStore.currentUser as Record<string, unknown>;
      reconcilePeer(rootScope.myId, mapBackendUser(meData, {self: true}) as any);
    }

    this.managers.appProfileManager.getProfile(rootScope.myId.toUserId()).catch(() => {});
    this.managers.appUsersManager.getSelf().catch(() => {});

    const myGiftsRow = new Row({
      titleLangKey: 'SharedMedia.Gifts',
      icon: 'gift',
      clickable: async() => {
        const tab = this.slider.createTab(AppSharedMediaTab, true);
        tab.isFirst = true;
        tab.setPeer(rootScope.myId);
        (await tab.fillProfileElements())();
        await tab.loadSidebarMedia(true);
        const giftsTabIndex = tab.searchSuper.mediaTabs.findIndex((it) => it.type === 'gifts');
        if(giftsTabIndex >= 0) {
          tab.searchSuper.selectTab(giftsTabIndex);
        }
        tab.open();
      },
      listenerSetter: this.listenerSetter
    });

    const openSettingsRow = new Row({
      titleLangKey: 'Settings',
      icon: 'settings',
      clickable: () => {
        this.slider.createTab(AppSettingsTab).open();
      },
      listenerSetter: this.listenerSetter
    });

    const actionsSection = new SettingSection();
    actionsSection.content.append(myGiftsRow.container, openSettingsRow.container);

    const settingsRowsSection = new SettingSection();
    const notificationsRow = new Row({
      titleLangKey: 'AccountSettings.Notifications',
      icon: 'unmute',
      clickable: () => this.slider.createTab(AppNotificationsTab).open(),
      listenerSetter: this.listenerSetter
    });
    const dataRow = new Row({
      titleLangKey: 'DataSettings',
      icon: 'data',
      clickable: () => this.slider.createTab(AppDataAndStorageTab).open(),
      listenerSetter: this.listenerSetter
    });
    const privacyRow = new Row({
      titleLangKey: 'AccountSettings.PrivacyAndSecurity',
      icon: 'lock',
      clickable: () => {
        const tab = this.slider.createTab(AppPrivacyAndSecurityTab);
        tab.open((AppPrivacyAndSecurityTab as any).getInitArgs?.(this));
      },
      listenerSetter: this.listenerSetter
    });
    const generalRow = new Row({
      titleLangKey: 'Telegram.GeneralSettingsViewController',
      icon: 'settings',
      clickable: () => {
        const tab = this.slider.createTab(AppGeneralSettingsTab);
        tab.open((AppGeneralSettingsTab as any).getInitArgs?.(this));
      },
      listenerSetter: this.listenerSetter
    });
    const foldersRow = new Row({
      titleLangKey: 'AccountSettings.Filters',
      icon: 'folder',
      clickable: () => this.slider.createTab(AppChatFoldersTab).open(),
      listenerSetter: this.listenerSetter
    });
    const stickersRow = new Row({
      titleLangKey: 'StickersName',
      icon: 'stickers_face',
      clickable: () => {
        const tab = this.slider.createTab(AppStickersAndEmojiTab);
        tab.open((AppStickersAndEmojiTab as any).getInitArgs?.(this));
      },
      listenerSetter: this.listenerSetter
    });
    const devicesRow = new Row({
      titleLangKey: 'Devices',
      icon: 'activesessions',
      clickable: () => this.slider.createTab(AppActiveSessionsTab).open(),
      listenerSetter: this.listenerSetter
    });
    settingsRowsSection.content.append(
      notificationsRow.container,
      dataRow.container,
      privacyRow.container,
      generalRow.container,
      foldersRow.container,
      stickersRow.container,
      devicesRow.container
    );

    this.scrollable.append(peerProfileElement, actionsSection.container, settingsRowsSection.container);
  }
}
