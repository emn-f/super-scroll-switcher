import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const SMOOTH_SCROLL_THRESHOLD = 1.0;
const OVERLAY_KEY_SUPPRESS_US = 100_000;
const MAX_FOCUS_RETRIES = 10;

export default class SuperScrollSwitcherExtension extends Extension {
    enable() {
        this._switchingActive = false;
        this._lastSelectedPreview = null;
        this._smoothDelta = 0;
        this._suppressToggleUntil = 0;
        this._pendingIdleId = 0;

        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(Main.overview, 'toggle', originalToggle => {
            const self = this;
            return function (...args) {
                if (GLib.get_monotonic_time() < self._suppressToggleUntil)
                    return;
                return originalToggle.apply(this, args);
            };
        });

        this._stageCapturedId = global.stage.connect(
            'captured-event',
            this._onCapturedEvent.bind(this)
        );

        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._resetState();
        });
    }

    disable() {
        if (this._stageCapturedId) {
            global.stage.disconnect(this._stageCapturedId);
            this._stageCapturedId = 0;
        }

        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }

        if (this._injectionManager) {
            this._injectionManager.clear();
            this._injectionManager = null;
        }

        this._resetState();
    }

    _resetState() {
        if (this._pendingIdleId) {
            GLib.source_remove(this._pendingIdleId);
            this._pendingIdleId = 0;
        }

        this._switchingActive = false;
        this._lastSelectedPreview = null;
        this._smoothDelta = 0;
    }

    _onCapturedEvent(_actor, event) {
        const type = event.type();

        if (type === Clutter.EventType.KEY_RELEASE)
            return this._handleKeyRelease(event);

        if (type === Clutter.EventType.SCROLL)
            return this._handleScroll(event);

        return Clutter.EVENT_PROPAGATE;
    }

    _handleKeyRelease(event) {
        if (!this._switchingActive)
            return Clutter.EVENT_PROPAGATE;

        const symbol = event.get_key_symbol();
        if (symbol !== Clutter.KEY_Super_L && symbol !== Clutter.KEY_Super_R)
            return Clutter.EVENT_PROPAGATE;

        this._finishSwitching();
        return Clutter.EVENT_PROPAGATE;
    }

    _handleScroll(event) {
        const allowedModes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        if ((Main.actionMode & allowedModes) === 0)
            return Clutter.EVENT_PROPAGATE;

        const state = event.get_state();
        const {compositorModifiers} = global.display;
        if (!compositorModifiers || (state & compositorModifiers) !== compositorModifiers)
            return Clutter.EVENT_PROPAGATE;

        // Super + Shift + Scroll keeps native workspace switching.
        if ((state & Clutter.ModifierType.SHIFT_MASK) !== 0)
            return Clutter.EVENT_PROPAGATE;

        const step = this._getScrollStep(event);
        if (step === 0)
            return Clutter.EVENT_STOP;

        if (!Main.overview.visible)
            Main.overview.show();

        this._switchingActive = true;
        this._stepFocus(step);

        return Clutter.EVENT_STOP;
    }

    _getScrollStep(event) {
        const direction = event.get_scroll_direction();

        switch (direction) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            return -1;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            return 1;
        case Clutter.ScrollDirection.SMOOTH: {
            // Wheel sources also emit discrete UP/DOWN events; ignore smooth to avoid double-stepping.
            if (event.get_scroll_source() === Clutter.ScrollSource.WHEEL)
                return 0;

            const [dx, dy] = event.get_scroll_delta();
            if (dx === 0 && dy === 0)
                return 0;

            const delta = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
            this._smoothDelta += delta;

            if (Math.abs(this._smoothDelta) < SMOOTH_SCROLL_THRESHOLD)
                return 0;

            const step = this._smoothDelta > 0 ? 1 : -1;
            this._smoothDelta = 0;
            return step;
        }
        default:
            return 0;
        }
    }

    _getActiveWorkspacePreviews() {
        const workspacesDisplay = Main.overview._overview?.controls?._workspacesDisplay;
        if (!workspacesDisplay?._workspacesViews?.length)
            return [];

        const monitorIndex = Main.layoutManager.currentMonitor?.index ?? Main.layoutManager.primaryIndex;
        const view = workspacesDisplay._workspacesViews[monitorIndex]
            ?? workspacesDisplay._workspacesViews[Main.layoutManager.primaryIndex];

        const workspace = view?.getActiveWorkspace?.();
        if (!workspace)
            return [];

        const chain = workspace.vfunc_get_focus_chain?.();
        if (chain && chain.length > 0)
            return chain;

        return workspace._windows ?? [];
    }

    _stepFocus(step, retries = 0) {
        const previews = this._getActiveWorkspacePreviews();
        if (previews.length === 0) {
            if (retries < MAX_FOCUS_RETRIES && !this._pendingIdleId) {
                this._pendingIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._pendingIdleId = 0;
                    if (this._switchingActive)
                        this._stepFocus(step, retries + 1);
                    return GLib.SOURCE_REMOVE;
                });
            }
            return;
        }

        let currentIdx = previews.indexOf(global.stage.key_focus);
        if (currentIdx === -1 && this._lastSelectedPreview)
            currentIdx = previews.indexOf(this._lastSelectedPreview);

        let nextIdx;
        if (currentIdx === -1) {
            const activeWindow = global.display.focus_window;
            const activeIdx = activeWindow
                ? previews.findIndex(p => p.metaWindow === activeWindow)
                : -1;

            if (activeIdx !== -1 && previews.length > 1)
                nextIdx = (activeIdx + step + previews.length) % previews.length;
            else
                nextIdx = step > 0 ? 0 : previews.length - 1;
        } else {
            nextIdx = (currentIdx + step + previews.length) % previews.length;
        }

        const target = previews[nextIdx];
        if (!target)
            return;

        this._lastSelectedPreview = target;
        target.grab_key_focus();
    }

    _finishSwitching() {
        const target = previewsContainsFocus(this._getActiveWorkspacePreviews())
            ?? this._lastSelectedPreview;

        this._resetState();
        this._suppressToggleUntil = GLib.get_monotonic_time() + OVERLAY_KEY_SUPPRESS_US;

        if (target && !target._destroyed && typeof target._activate === 'function')
            target._activate();
        else if (Main.overview.visible)
            Main.overview.hide();
    }
}

function previewsContainsFocus(previews) {
    const focus = global.stage.key_focus;
    return previews.includes(focus) ? focus : null;
}
