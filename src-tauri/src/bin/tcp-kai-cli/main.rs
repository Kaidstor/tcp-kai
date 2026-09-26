//! tcp-kai — CLI к приложению tcp-kai: шлёт сохранённые в нём запросы к
//! микросервисам, не открывая GUI.
//!
//! База общая с приложением: коллекция = микросервис, пак переменных = стенд
//! (`local`/`prod`). Поэтому `tcp-kai coordinator get-domains -e prod` шлёт
//! ровно то же, что кнопка в приложении, и так же попадает в историю.
//!
//! Секреты (`--from-sec`) не хранятся в базе приложения, а приезжают из `sec`:
//! проект `tcp-kai-<ms>`, инстанс = имя пака.

mod cmd;
mod daemon;
mod output;
mod sec;
mod vars;

use std::ffi::OsString;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use output::{CliError, Done, Printer};

#[derive(Parser)]
#[command(
    name = "tcp-kai",
    // без bin_name в usage светился бы argv[0] — «tcp-kai-cli» при запуске
    // файла из бандла; команда для пользователя всегда tcp-kai
    bin_name = "tcp-kai",
    version,
    about = "Запросы к микросервисам по коллекциям tcp-kai (паки переменных, история общая с GUI)",
    after_help = "Примеры:\n  \
        tcp-kai coordinator read-recon-links-for-period\n  \
        tcp-kai coordinator get-domains -e local        # стенд вместо применённого в GUI\n  \
        echo '{\"limit\":10}' | tcp-kai whois get-domains --json | jq .data\n  \
        tcp-kai fuzzing scan --var port=18099           # разовое значение\n  \
        tcp-kai notifier send --from-sec                # токен из sec, не из базы\n  \
        tcp-kai new billing --url 127.0.0.1:18011       # новая коллекция со стендом\n  \
        tcp-kai ls                                      # коллекции\n  \
        tcp-kai ls coordinator                          # запросы коллекции\n  \
        tcp-kai envs coordinator                        # паки переменных\n  \
        tcp-kai doctor coordinator -e prod              # база, коллекции, доступность адреса\n\n\
        --json на любой команде: конверт {v, command, exit, data, warning, error{kind, message}}\n\
        в stdout, отказ — тем же конвертом. У send в data — ответ сервиса как есть.\n\n\
        Коды выхода:\n  \
        0  сделано\n  \
        1  сервис ответил, но результата нет: err в ответе, в контракте нет cmd, скилл не встал\n  \
        2  ошибка инструмента, аргументов, настроек или базы; соединение не установилось\n  \
        3  не найдено: коллекция, запрос, пак, файл\n  \
        4  сервис не ответил в срок. Не ответил на connect — повтор безопасен;\n     \
           не ответил на запрос — кадр ушёл, запись повторять нельзя"
)]
struct Cli {
    /// Машинночитаемый вывод: JSON-конверт в stdout, отказ — тоже
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Отправить запрос (tcp-kai <ms> <cmd> — то же самое)
    Send(cmd::send::SendArgs),
    /// Коллекции, или запросы одной коллекции
    Ls(cmd::ls::LsArgs),
    /// Завести коллекцию (микросервис) с паком переменных
    New(cmd::new::NewArgs),
    /// Паки переменных, доступные коллекции
    Envs(cmd::envs::EnvsArgs),
    /// Импорт cmd-паттернов из NestJS-контракта в коллекцию
    Import(cmd::import::ImportArgs),
    /// Показать, что парсер найдёт в контракте (без импорта и базы)
    Parse(cmd::parse::ParseArgs),
    /// Последние обмены запроса из общей с GUI истории
    History(cmd::history::HistoryArgs),
    /// Диагностика: база приложения, коллекции, доступность адреса из пака
    Doctor(cmd::doctor::DoctorArgs),
    /// Keep-alive-демон: пул TCP-соединений между вызовами (run/status/stop)
    Daemon(cmd::daemon::DaemonArgs),
    /// Агентский скилл tcp-kai: установка в ~/.claude и ~/.codex (install/status)
    Skills(cmd::skills::SkillsArgs),
    /// Шелл-дополнения: tcp-kai completions zsh
    Completions {
        /// Шелл: bash, zsh, fish, elvish, powershell
        shell: clap_complete::Shell,
    },
}

impl Cmd {
    fn name(&self) -> &'static str {
        match self {
            Cmd::Send(_) => "send",
            Cmd::Ls(_) => "ls",
            Cmd::New(_) => "new",
            Cmd::Envs(_) => "envs",
            Cmd::Import(_) => "import",
            Cmd::Parse(_) => "parse",
            Cmd::History(_) => "history",
            Cmd::Doctor(_) => "doctor",
            Cmd::Daemon(_) => "daemon",
            Cmd::Skills(_) => "skills",
            Cmd::Completions { .. } => "completions",
        }
    }
}

/// `tcp-kai <ms> <cmd>` — шорткат для `tcp-kai send <ms> <cmd>`: если первый
/// аргумент не подкоманда и не флаг, считаем его именем коллекции.
///
/// Список подкоманд берём из самого clap, чтобы новая команда не начала молча
/// читаться как имя микросервиса. Глобальный `--json` может стоять перед
/// именем коллекции — его пропускаем.
fn subcommand_names() -> Vec<String> {
    use clap::CommandFactory;

    Cli::command()
        .get_subcommands()
        .flat_map(|c| {
            std::iter::once(c.get_name().to_string()).chain(c.get_all_aliases().map(str::to_string))
        })
        .chain(std::iter::once("help".to_string()))
        .collect()
}

fn preprocess_args(mut args: Vec<OsString>) -> Vec<OsString> {
    let known = subcommand_names();
    let first = args
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, a)| *a != "--json")
        .map(|(i, a)| (i, a.to_string_lossy().into_owned()));
    if let Some((i, s)) = first {
        if !s.starts_with('-') && !known.contains(&s) {
            args.insert(i, "send".into());
        }
    }
    args
}

fn main() -> ExitCode {
    let args = preprocess_args(std::env::args_os().collect());
    let cli = match Cli::try_parse_from(&args) {
        Ok(cli) => cli,
        Err(e) => return parse_failure(e, &args),
    };

    let command = cli.cmd.name();
    let mut printer = Printer::new(cli.json);
    let rt = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            return printer.finish(
                command,
                Err(CliError::new(
                    output::code::TOOL,
                    "internal",
                    format!("tokio: {e}"),
                )),
            )
        }
    };

    let result = rt.block_on(dispatch(cli.cmd, &mut printer));
    printer.finish(command, result)
}

fn parse_failure(e: clap::Error, args: &[OsString]) -> ExitCode {
    use clap::error::ErrorKind;

    let json = args.iter().skip(1).any(|a| a == "--json");
    let is_info = matches!(
        e.kind(),
        ErrorKind::DisplayHelp
            | ErrorKind::DisplayVersion
            | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand
    );
    if !json || is_info {
        let _ = e.print();
        return ExitCode::from(e.exit_code() as u8);
    }
    let known = subcommand_names();
    let command = args
        .iter()
        .skip(1)
        .map(|a| a.to_string_lossy())
        .find(|a| known.iter().any(|k| k == a))
        .map(|a| a.into_owned())
        .unwrap_or_default();
    let message = e.render().to_string();
    Printer::new(true).finish(&command, Err(CliError::usage(message.trim_end())))
}

async fn dispatch(cmd: Cmd, p: &mut Printer) -> Result<Done, CliError> {
    match cmd {
        Cmd::Send(args) => {
            let res = cmd::send::run(args, p).await;
            // самолечение агентского скилла: апгрейд бинаря (brew, updater,
            // cargo) догоняет разложенные копии первым же вызовом send.
            // Только копии со стампом — симлинки и ручные не трогаются
            tcp_kai_lib::skills_sync::sync_all_stale();
            res
        }
        Cmd::Ls(args) => cmd::ls::run(args, p).await,
        Cmd::New(args) => cmd::new::run(args, p).await,
        Cmd::Envs(args) => cmd::envs::run(args, p).await,
        Cmd::Import(args) => cmd::import::run(args, p).await,
        Cmd::Parse(args) => cmd::parse::run(args, p).await,
        Cmd::History(args) => cmd::history::run(args, p).await,
        Cmd::Doctor(args) => cmd::doctor::run(args, p).await,
        Cmd::Daemon(args) => cmd::daemon::run(args, p).await,
        Cmd::Skills(args) => cmd::skills::run(args, p),
        Cmd::Completions { shell } => {
            use clap::CommandFactory;
            let mut command = Cli::command();
            if !p.json {
                clap_complete::generate(shell, &mut command, "tcp-kai", &mut std::io::stdout());
                return Ok(Done::ok(()));
            }
            let mut script = Vec::new();
            clap_complete::generate(shell, &mut command, "tcp-kai", &mut script);
            Ok(Done::ok(serde_json::json!({
                "shell": shell.to_string(),
                "script": String::from_utf8_lossy(&script),
            })))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pre(args: &[&str]) -> Vec<String> {
        preprocess_args(args.iter().map(OsString::from).collect())
            .into_iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn collection_name_becomes_send() {
        assert_eq!(
            pre(&["tcp-kai", "whois", "get"]),
            ["tcp-kai", "send", "whois", "get"]
        );
    }

    #[test]
    fn json_before_collection_is_skipped() {
        assert_eq!(
            pre(&["tcp-kai", "--json", "whois", "get"]),
            ["tcp-kai", "--json", "send", "whois", "get"]
        );
    }

    #[test]
    fn subcommands_are_left_alone() {
        assert_eq!(pre(&["tcp-kai", "doctor"]), ["tcp-kai", "doctor"]);
        assert_eq!(
            pre(&["tcp-kai", "--json", "ls"]),
            ["tcp-kai", "--json", "ls"]
        );
    }

    #[test]
    fn json_is_global() {
        let cli = Cli::try_parse_from(["tcp-kai", "ls", "whois", "--json"]).unwrap();
        assert!(cli.json);
        let cli = Cli::try_parse_from(["tcp-kai", "send", "whois", "get", "--json"]).unwrap();
        assert!(cli.json);
    }

    #[test]
    fn clap_definition_is_valid() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
