import {Plugin, registerPlugin} from 'enmity/managers/plugins'
import {React} from 'enmity/metro/common'
import {create} from 'enmity/patcher'
// @ts-ignore
import manifest, {name as plugin_name} from '../manifest.json'
import Settings from "./components/Settings"
import {bulk, filters} from "enmity/modules"
import {getStoreHandlers} from "../../hook"

const [
    FluxDispatcher,
    UserStore,
    MessageStore,
    ReactNative
] = bulk(
    filters.byProps("_currentDispatchActionType", "_subscriptions", "_actionHandlers", "_waitQueue"),
    filters.byProps("getUser", "getUsers"),
    filters.byProps("getMessage", "getMessages"),
    filters.byProps("View")
)
const {DCDChatManager} = ReactNative.NativeModules

const [
    MessageHandlers,
    UserHandlers
] = [
    getStoreHandlers("MessageStore"),
    getStoreHandlers("UserStore")
]

const Patcher = create('TrackEdit')

const TrackEdit: Plugin = {
    ...manifest,
    onStart() {
        const filterEdited = (c) => c.content == "[TrackEdit]" && c.type == "inlineCode"
        const filterDeleted = (c) => c.content == "[TrackEdit]" && c.type == "inlineCode"
        const colorContent = (c, l) => {
            return {
                content: c,
                target: 'usernameOnClick',
                context: {
                    username: 1,
                    usernameOnClick: {
                        linkColor: ReactNative.processColor(l)
                    },
                    medium: true
                },
                type: 'link'
            }
        }

        // const unpatchCO = Patcher.after(UserHandlers, "CONNECTION_OPEN", (self, args, res) => {
        //     if (UserStore.getCurrentUser()?.id) {
        //         currentUser = UserStore.getCurrentUser().id
        //     }
        //     unpatchCO()
        // })


        Patcher.before(DCDChatManager, "updateRows", (_, args, __) => {
            const rows = JSON.parse(args[1])
            for (const row of rows) {
                if (row.message?.content && Array.isArray(row.message?.content)) {
                    if (row.message?.content.slice(0, 1).filter(c => filterDeleted(c)).length) {
                        row.message.edited = "deleted"
                        row.message.content = [
                            // まずTrackEditを削除し,その後TrackEditを削除する
                            colorContent(row.message.content.slice(1).filter(c => !filterEdited(c)), "#FF0000")
                        ]
                    } else if (row.message?.content.filter(c => filterEdited(c)).length) {
                        let idxes = row.message.content.map((c, idx) => filterEdited(c) ? idx : undefined).filter(v => v != undefined)
                        let newContent = row.message.content.slice(idxes[idxes.length - 1] + 1)
                        let orgContent = row.message.content.slice(0, idxes[idxes.length - 1]).filter(c => !filterEdited(c))
                        row.message.content = [
                            colorContent(orgContent, "#797979"),
                            ...newContent
                        ]
                    }
                }
            }
            args[1] = JSON.stringify(rows)
        })

        Patcher.before(MessageHandlers, "MESSAGE_UPDATE", (self, args, res) => {
            if (args[0].ignore || !args[0].guildId || args[0].message?.author?.id === UserStore?.getCurrentUser()?.id) return // guildIdがないものを除くことでDislate等での編集を除く.他のプラグインとの互換性を保つためにはignore:trueを指定
            const orgMessage = MessageStore.getMessage(args[0].message.channel_id, args[0].message.id)
            if (!orgMessage) return
            let orgText = orgMessage.content ? orgMessage.content.split("\n").map(t => t.replace(/^>>>/, "").replace(/^>/, "")).join("\n") : "" // 引用ブロックに含まれるとTrackEditが内包されて最上位階層で見つからなく可能性があるため消す
            let newText = args[0].message?.content ? args[0].message.content : ""
            if (orgText === newText) return // embed更新で編集判定してしまうのを防ぐ
            args[0].message.content = `${orgText} \`[TrackEdit]\`\n${newText}` // 空白がないとリンクに巻き込まれる可能性あり
        })

        Patcher.instead(MessageHandlers, "MESSAGE_DELETE", (self, args, org) => {
            const orgMessage = MessageStore.getMessage(args[0].channelId, args[0].id)
            if (!orgMessage || orgMessage.author?.id === UserStore?.getCurrentUser()?.id) {
                org.apply(self, args)
                return
            }
            let orgText = orgMessage.content ? orgMessage.content : ""
            const editEvent = {
                type: "MESSAGE_UPDATE",
                guildId: args[0].guildId,
                message: {
                    ...orgMessage,
                    content: `\`[TrackEdit]\`${orgText}`, // 後ろに置く必要はないので前に置く
                    guild_id: args[0].guildId
                },
                ignore: true // ここでのUPDATEを検知して編集判定しないようにする
            }
            FluxDispatcher.dispatch(editEvent)
        })
    },
    onStop() {
        Patcher.unpatchAll()
    },
    getSettingsPanel({settings}) {
        return <Settings settings={settings}/>
    }
}

registerPlugin(TrackEdit)
